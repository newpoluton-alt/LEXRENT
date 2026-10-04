import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SourceDocument } from "../src/domain/types";
import { validateRuleBundle } from "../src/domain/validation";
import { AiError, extractSourceChunk, getExtractionIdentity, isAiConfigured, type ExtractionResult } from "../src/server/ai";

export interface ExtractionCliOptions {
  docs: string[] | "all";
  maxRequests: number;
  planOnly: boolean;
  cacheDir: string;
}
export interface ExtractionTask {
  source: SourceDocument;
  chunk: number;
  cache_key: string;
  file: string;
}
type TaskStatus = "cached" | "extracted" | "failed" | "budget_skipped";
export interface ExtractionRunItem {
  doc_id: string; chunk: number; cache_key: string; status: TaskStatus; rules: number;
  input_tokens: number; output_tokens: number; error_code?: string;
}
const HELP = `LEXRENT automated extraction (drafts only; no database publication)
Usage: node --import tsx scripts/extract-corpus.ts --docs D022,D069 [--max-requests 12] [--plan]
       node --import tsx scripts/extract-corpus.ts --docs all --max-requests 200
--docs         Explicit comma-separated source IDs, or all captured compiled sources.
--max-requests Maximum new chunk extraction calls this run: 1..200, default 12.
--plan         Inspect sources/chunks/cache without calling Claude or writing drafts.
--cache-dir    Draft directory, default corpus/extractions.
Concurrency is bounded at 2. Cached chunks consume no new calls. The SDK can retry
an upstream request once; max-requests limits chunk calls, not transport attempts.
Every result requires legal/source review before import. A source link alone is insufficient.`;

export function parseExtractionArgs(args: readonly string[], cwd = process.cwd()): ExtractionCliOptions | null {
  if (!args.length || args.includes("--help") || args.includes("-h")) return null;
  const options: ExtractionCliOptions = { docs: [], maxRequests: 12, planOnly: false, cacheDir: resolve(cwd, "corpus/extractions") };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new AiError("CLI_INVALID_ARGUMENT", "Each option may be supplied only once.", 400);
    seen.add(flag);
    if (flag === "--plan") { options.planOnly = true; continue; }
    if (!["--docs", "--max-requests", "--cache-dir"].includes(flag)) throw new AiError("CLI_INVALID_ARGUMENT", "Use --help to inspect the supported options.", 400);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new AiError("CLI_INVALID_ARGUMENT", "An option value is missing.", 400);
    if (flag === "--docs") {
      options.docs = value === "all" ? "all" : [...new Set(value.split(",").map(id => id.trim()).filter(Boolean))];
      if (options.docs !== "all" && (!options.docs.length || options.docs.some(id => !/^[DS]\d{3}$/.test(id)))) throw new AiError("CLI_INVALID_DOCS", "Source IDs must match compiled source IDs, for example D022 or S001.", 400);
    } else if (flag === "--max-requests") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 200) throw new AiError("CLI_INVALID_BUDGET", "The request limit must be an integer from 1 to 200.", 400);
      options.maxRequests = Number(value);
    } else options.cacheDir = resolve(cwd, value);
  }
  if (Array.isArray(options.docs) && !options.docs.length) throw new AiError("CLI_DOCS_REQUIRED", "Select --docs explicitly before extraction.", 400);
  return options;
}

export function planExtraction(sources: readonly SourceDocument[], options: ExtractionCliOptions): ExtractionTask[] {
  const selected = options.docs === "all" ? sources.filter(source => source.captured && source.text?.trim()) : options.docs.map(id => {
    const source = sources.find(item => item.doc_id === id);
    if (!source) throw new AiError("CLI_SOURCE_NOT_FOUND", "A requested source is absent from the compiled corpus.", 404);
    return source;
  });
  return selected.flatMap(source => getExtractionIdentity(source).chunks.map(chunk => {
    const identity = getExtractionIdentity(source, chunk.index);
    return { source, chunk: chunk.index, cache_key: identity.cache_key, file: join(options.cacheDir, `${identity.cache_key}.json`) };
  }));
}

const cachedResultSchema = z.object({
  bundle: z.unknown(), doc_id: z.string(), chunk: z.number().int().nonnegative(), total_chunks: z.number().int().positive(), next_chunk: z.number().int().nonnegative().nullable(),
  chunk_start: z.number().int().nonnegative(), chunk_end: z.number().int().positive(), source_sha256: z.string(), model: z.string(), warnings: z.array(z.string()),
  requires_review: z.literal(true), cache_hit: z.boolean(), usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
  created_at: z.string().datetime(), prompt_version: z.string(),
}).strict();
const draftCacheSchema = z.object({ schema_version: z.literal(1), cache_key: z.string(), source_url: z.string(), result: cachedResultSchema }).strict();

/** A cache is reusable only for the exact source bytes, model, prompt and chunk. */
export function validCachedExtraction(input: unknown, task: ExtractionTask): ExtractionResult | null {
  const parsed = draftCacheSchema.safeParse(input);
  if (!parsed.success) return null;
  const { result, cache_key, source_url } = parsed.data;
  const identity = getExtractionIdentity(task.source, task.chunk), chunk = identity.chunks[task.chunk];
  if (cache_key !== task.cache_key || source_url !== task.source.url || result.doc_id !== task.source.doc_id || result.chunk !== task.chunk || result.source_sha256 !== identity.source_hash || result.model !== identity.model || result.prompt_version !== identity.prompt_version || result.total_chunks !== identity.chunks.length || result.chunk_start !== chunk.start || result.chunk_end !== chunk.end || result.next_chunk !== (task.chunk + 1 < identity.chunks.length ? task.chunk + 1 : null)) return null;
  const validated = validateRuleBundle(result.bundle, [task.source]);
  return validated.valid && validated.bundle ? { ...result, bundle: validated.bundle, cache_hit: true } : null;
}

async function readCached(task: ExtractionTask) {
  try { return validCachedExtraction(JSON.parse(await readFile(task.file, "utf8")), task); }
  catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AiError("CLI_CACHE_READ_FAILED", "A draft cache could not be read. No model call was made for that chunk.", 500);
  }
}
async function writeJsonAtomic(file: string, data: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, file);
}
const safeErrorCode = (error: unknown) => error instanceof AiError && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "CLI_EXTRACTION_FAILED";
const runItem = (task: ExtractionTask, status: TaskStatus, result?: ExtractionResult, code?: string): ExtractionRunItem => ({ doc_id: task.source.doc_id, chunk: task.chunk, cache_key: task.cache_key, status, rules: result?.bundle.rules.length ?? 0, input_tokens: result?.usage.input_tokens ?? 0, output_tokens: result?.usage.output_tokens ?? 0, ...(code ? { error_code: code } : {}) });

export async function runCorpusExtraction(sources: readonly SourceDocument[], options: ExtractionCliOptions, dependencies: { extract?: typeof extractSourceChunk; configured?: () => boolean; report?: (item: ExtractionRunItem) => void } = {}) {
  const tasks = planExtraction(sources, options);
  const cached = await Promise.all(tasks.map(readCached));
  const newTasks = tasks.filter((_, i) => !cached[i]);
  const planned = { sources: new Set(tasks.map(task => task.source.doc_id)).size, chunks: tasks.length, cached_chunks: cached.filter(Boolean).length, new_chunks: newTasks.length, max_new_requests: options.maxRequests, planned_new_requests: Math.min(newTasks.length, options.maxRequests), max_sdk_transport_attempts: Math.min(newTasks.length, options.maxRequests) * 2, requires_review: true as const };
  if (options.planOnly) return { ...planned, plan_only: true as const, items: tasks.map((task, i) => ({ doc_id: task.source.doc_id, chunk: task.chunk, total_chunks: getExtractionIdentity(task.source).chunks.length, cache_key: task.cache_key, cached: Boolean(cached[i]) })) };
  if (newTasks.length && !(dependencies.configured ?? isAiConfigured)()) throw new AiError("AI_NOT_CONFIGURED", "Configure the local Anthropic key before running extraction.", 503);
  await mkdir(options.cacheDir, { recursive: true });
  const items = new Map<string, ExtractionRunItem>();
  tasks.forEach((task, i) => { if (cached[i]) items.set(task.cache_key, runItem(task, "cached", cached[i]!)); });
  const queued = newTasks.slice(0, options.maxRequests);
  for (const task of newTasks.slice(options.maxRequests)) items.set(task.cache_key, runItem(task, "budget_skipped"));
  let cursor = 0;
  async function worker() {
    while (cursor < queued.length) {
      const task = queued[cursor++];
      let item: ExtractionRunItem;
      try {
        const result = await (dependencies.extract ?? extractSourceChunk)(task.source, task.chunk);
        const envelope = { schema_version: 1, cache_key: task.cache_key, source_url: task.source.url, result };
        if (!validCachedExtraction(envelope, task)) throw new AiError("CLI_INVALID_EXTRACTION", "The extraction result does not match its source identity.", 422);
        await writeJsonAtomic(task.file, envelope);
        item = runItem(task, "extracted", result);
      } catch (error) { item = runItem(task, "failed", undefined, safeErrorCode(error)); }
      items.set(task.cache_key, item); dependencies.report?.(item);
    }
  }
  await Promise.all([worker(), worker()]);
  const ordered = tasks.map(task => items.get(task.cache_key)!);
  const attempted = ordered.filter(item => ["extracted", "failed"].includes(item.status));
  const report = { ...planned, plan_only: false as const, created_at: new Date().toISOString(), attempted_requests: attempted.length, completed_chunks: ordered.filter(item => ["cached", "extracted"].includes(item.status)).length, failed_chunks: ordered.filter(item => item.status === "failed").length, skipped_chunks: ordered.filter(item => item.status === "budget_skipped").length, new_usage: { input_tokens: attempted.reduce((sum, item) => sum + item.input_tokens, 0), output_tokens: attempted.reduce((sum, item) => sum + item.output_tokens, 0) }, usage_note: "Usage reports successful new chunk responses; failed upstream/validation attempts may consume provider credits without reported token counts. SDK retry attempts are bounded at one retry per chunk call.", items: ordered };
  await writeJsonAtomic(join(options.cacheDir, `run-${Date.now()}-${randomUUID()}.json`), report);
  return report;
}

async function main() {
  const options = parseExtractionArgs(process.argv.slice(2));
  if (!options) { console.info(HELP); return; }
  for (const filename of [".env.local", ".env"]) {
    try { loadEnvFile(resolve(process.cwd(), filename)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AiError("CLI_ENV_LOAD_FAILED", "The local environment file could not be loaded.", 500); }
  }
  const data = JSON.parse(await readFile(resolve(process.cwd(), "src/data/challenge.json"), "utf8")) as { sources: SourceDocument[] };
  const result = await runCorpusExtraction(data.sources, options, { report: item => console.info(JSON.stringify(item)) });
  console.info(JSON.stringify(result));
  if (!result.plan_only && (result.failed_chunks || result.skipped_chunks)) process.exitCode = 2;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => { console.error(JSON.stringify({ error_code: safeErrorCode(error), requires_review: true, published: false })); process.exitCode = 1; });
}
