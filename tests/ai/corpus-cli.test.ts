import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../../src/domain/types";
import { getExtractionIdentity, type ExtractionResult } from "../../src/server/ai";
import { parseExtractionArgs, planExtraction, runCorpusExtraction, validCachedExtraction, type ExtractionCliOptions } from "../../scripts/extract-corpus";

const text = "Synthetic test-only source sentence supporting a distinct test obligation. ".repeat(600);
const source: SourceDocument = { doc_id: "D999", jurisdictions: "CA", url: "https://example.invalid/source", source_type: "synthetic test fixture", capture: "yes", retrieved_at: "2026-10-01T00:00:00Z", sha256: "original-metadata", text_file: "test", status: "ok", captured: true, text };
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function options(maxRequests = 12): Promise<ExtractionCliOptions> {
  const cacheDir = await mkdtemp(join(tmpdir(), "lexrent-cli-test-")); directories.push(cacheDir);
  return { docs: [source.doc_id], maxRequests, planOnly: false, cacheDir };
}
function result(document: SourceDocument, chunk = 0): ExtractionResult {
  const identity = getExtractionIdentity(document, chunk), selected = identity.chunks[chunk];
  const id = `test-${chunk}`;
  return { bundle: { rules: [{ team_rule_id: id, jurisdiction: "CA", level: "state", category: "security_deposits", status: "in_force", title: id, requirement: "Synthetic obligation for testing only.", citation: `Test section ${chunk}`, source_doc_id: document.doc_id, source_url: document.url, quoted_span: document.text!.slice(selected.start, selected.start + 70) }], ruleLogic: { [id]: { coverage: { all: [] } } } }, doc_id: document.doc_id, chunk, total_chunks: identity.chunks.length, next_chunk: chunk + 1 < identity.chunks.length ? chunk + 1 : null, chunk_start: selected.start, chunk_end: selected.end, source_sha256: identity.source_hash, model: identity.model, warnings: ["Test only: review required."], requires_review: true, cache_hit: false, usage: { input_tokens: 100, output_tokens: 20 }, created_at: "2026-10-04T00:00:00.000Z", prompt_version: identity.prompt_version };
}

describe("bounded resumable corpus extraction CLI", () => {
  it("requires explicit source selection and bounds new-call budget", () => {
    expect(parseExtractionArgs([])).toBeNull();
    expect(() => parseExtractionArgs(["--max-requests", "2"])).toThrow();
    expect(() => parseExtractionArgs(["--docs", "all", "--max-requests", "201"])).toThrow();
    expect(() => parseExtractionArgs(["--docs", "all", "--max-requests", "1.5"])).toThrow();
    expect(() => parseExtractionArgs(["--docs", "../private"])).toThrow();
    expect(parseExtractionArgs(["--docs", "D022,D022,D069", "--plan"], "/tmp")).toMatchObject({ docs: ["D022", "D069"], maxRequests: 12, planOnly: true });
    expect(parseExtractionArgs(["--docs", "S001,S002", "--plan"])?.docs).toEqual(["S001", "S002"]);
  });

  it("plans every captured chunk without calling a provider or requiring credentials", async () => {
    const config = { ...await options(), docs: "all" as const, planOnly: true };
    const extract = vi.fn(), configured = vi.fn(() => false);
    const plan = await runCorpusExtraction([source, { ...source, doc_id: "D998", captured: false, text: undefined }], config, { extract, configured });
    expect(plan).toMatchObject({ sources: 1, chunks: 3, cached_chunks: 0, planned_new_requests: 3, max_sdk_transport_attempts: 6, plan_only: true });
    expect(extract).not.toHaveBeenCalled();
    expect(configured).not.toHaveBeenCalled();
    expect(await readdir(config.cacheDir)).toEqual([]);
  });

  it("resumes exact cached chunks and never exceeds two concurrent calls", async () => {
    vi.stubEnv("CLAUDE_MODEL", "test-model");
    const config = await options(1);
    const firstExtract = vi.fn(async (doc: SourceDocument, chunk?: number) => result(doc, chunk));
    const first = await runCorpusExtraction([source], config, { extract: firstExtract, configured: () => true });
    expect(first).toMatchObject({ attempted_requests: 1, completed_chunks: 1, skipped_chunks: 2, new_usage: { input_tokens: 100, output_tokens: 20 } });
    let running = 0, maximum = 0;
    const remainingExtract = vi.fn(async (doc: SourceDocument, chunk?: number) => {
      running++; maximum = Math.max(maximum, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running--; return result(doc, chunk);
    });
    const second = await runCorpusExtraction([source], { ...config, maxRequests: 12 }, { extract: remainingExtract, configured: () => true });
    expect(second).toMatchObject({ cached_chunks: 1, attempted_requests: 2, completed_chunks: 3, skipped_chunks: 0 });
    expect(maximum).toBe(2);
    expect(remainingExtract).toHaveBeenCalledTimes(2);
    const noCall = vi.fn();
    expect(await runCorpusExtraction([source], config, { extract: noCall, configured: () => false })).toMatchObject({ cached_chunks: 3, attempted_requests: 0 });
    expect(noCall).not.toHaveBeenCalled();
  });

  it("rejects source/model changes, edited quotes and publication claims in cache", async () => {
    const config = await options();
    const task = planExtraction([source], config)[0], output = result(source);
    const envelope = { schema_version: 1, cache_key: task.cache_key, source_url: source.url, result: output };
    expect(validCachedExtraction(envelope, task)?.cache_hit).toBe(true);
    expect(validCachedExtraction({ ...envelope, result: { ...output, requires_review: false } }, task)).toBeNull();
    const altered = structuredClone(envelope);
    altered.result.bundle.rules[0].quoted_span = "This fabricated quotation is not in the test capture.";
    expect(validCachedExtraction(altered, task)).toBeNull();
    const changedSource = { ...source, text: source.text + "A revised capture." };
    expect(validCachedExtraction(envelope, planExtraction([changedSource], config)[0])).toBeNull();
    vi.stubEnv("CLAUDE_MODEL", "different-model");
    expect(validCachedExtraction(envelope, planExtraction([source], config)[0])).toBeNull();
  });

  it("counts failed calls, preserves successes and reports only sanitized failure codes", async () => {
    const config = await options(2);
    const extract = vi.fn(async (doc: SourceDocument, chunk?: number) => {
      if (chunk === 0) throw new Error("private provider error containing a fake test credential");
      return result(doc, chunk);
    });
    const run = await runCorpusExtraction([source], config, { extract, configured: () => true });
    expect(run).toMatchObject({ attempted_requests: 2, failed_chunks: 1, completed_chunks: 1, skipped_chunks: 1 });
    expect(JSON.stringify(run)).not.toContain("fake test credential");
    expect(JSON.stringify(run)).toContain("CLI_EXTRACTION_FAILED");
    const files = await readdir(config.cacheDir);
    expect(files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))).toHaveLength(1);
    const saved = JSON.parse(await readFile(join(config.cacheDir, files.find(file => /^[a-f0-9]{64}\.json$/.test(file))!), "utf8"));
    expect(saved.result.requires_review).toBe(true);
  });
});
