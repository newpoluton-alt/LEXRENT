import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import type { ChallengeData, PropertyRecord, SourceDocument, RuleBundle } from "../src/domain/types";
import { validateRuleBundle } from "../src/domain/validation";
import { validateKnowledgeBaseChunks } from "../src/domain/retrieval-index";
import { createHash } from "node:crypto";

async function main() {
const root = resolve(process.cwd(), "participant-final-no-hour16 3");
const parseCsv = async (path: string): Promise<Record<string, string>[]> => parse(await readFile(resolve(root, path), "utf8"), { columns: true, skip_empty_lines: true, bom: true });
const aliases: Record<string, string> = { "San Ysidro": "San Diego", "South Boston": "Boston", "Brighton": "Boston", "Allston": "Boston", "Roxbury": "Boston", "Dorchester": "Boston", "Jamaica Plain": "Boston", "East Boston": "Boston", "Hyde Park": "Boston", "Mattapan": "Boston", "Van Nuys": "Los Angeles" };
const numberOrNull = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const properties: PropertyRecord[] = (await parseCsv("data/sample_addresses.csv")).map(row => {
  const year = numberOrNull(row.year_built), units = numberOrNull(row.units);
  const quality_flags: string[] = [];
  if (!row.zip) quality_flags.push("missing_zip");
  else if (!/^\d{5}$/.test(row.zip)) quality_flags.push("invalid_zip_format");
  else if (row.state === "NJ" && !/^0[78]/.test(row.zip)) quality_flags.push("zip_state_mismatch");
  if (/^\d+\s*-\s*\d+/.test(row.street_address)) quality_flags.push("street_number_range");
  return { ...row, year_built: year, units, legal_city_candidate: aliases[row.postal_city] ?? row.postal_city, jurisdiction_status: "unresolved", missing_facts: ["legal_municipality", ...(!year ? ["year_built"] : []), ...(units === null ? ["units"] : [])], quality_flags } as PropertyRecord;
});
const sources: SourceDocument[] = await Promise.all((await parseCsv("corpus/corpus_manifest.csv")).map(async row => {
  let text: string | undefined;
  if (row.text_file) { try { text = await readFile(resolve(root, "corpus", row.text_file), "utf8"); } catch { /* The manifest retains the original capture failure. */ } }
  return { ...row, captured: text !== undefined, ...(text !== undefined ? { text } : {}) } as SourceDocument;
}));
try {
  const supplement = JSON.parse(await readFile(resolve(process.cwd(), "corpus/supplemental-sources.json"), "utf8")) as SourceDocument[];
  for (const source of supplement) {
    if (!source.captured) continue;
    const text = await readFile(resolve(process.cwd(), "corpus", source.text_file), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== source.sha256) throw new Error(`Source capture hash mismatch: ${source.doc_id}`);
    sources.push({ ...source, text });
  }
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const data: ChallengeData = { generated_at: new Date().toISOString(), properties, sources, changeFixtures: JSON.parse(await readFile(resolve(root, "dev/change_tests.json"), "utf8")), verifiedRules: [] };
for (const knowledgeFile of ["AI RAG/rag_knowledge_base.jsonl", "AI capabilities/rag_knowledge_base.jsonl"]) {
try {
  const records = (await readFile(resolve(process.cwd(), knowledgeFile), "utf8")).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>);
  const knowledge = validateKnowledgeBaseChunks(records, sources);
  data.knowledgeBaseChunks = knowledge.chunks;
  data.knowledgeBaseAudit = knowledge.audit;
  break;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
}
// Preserve the supplied manifest digest, but use the actual captured bytes for
// evaluation, cache fingerprints, citations and vector-index invalidation.
for (const source of sources) if (source.captured && source.text !== undefined) {
  source.manifest_sha256 = source.sha256;
  source.sha256 = createHash("sha256").update(source.text).digest("hex");
}
for (const chunk of data.knowledgeBaseChunks ?? []) chunk.source_sha256 = sources.find(source => source.doc_id === chunk.doc_id)!.sha256;
const compiled: RuleBundle = { rules: [], ruleLogic: {} };
for (const name of ["california-rules.json", "new-jersey-massachusetts-rules.json"]) {
  try {
    const bundle = JSON.parse(await readFile(resolve(process.cwd(), "corpus", name), "utf8")) as RuleBundle;
    compiled.rules.push(...bundle.rules); Object.assign(compiled.ruleLogic, bundle.ruleLogic);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
if (compiled.rules.length) {
  const checked = validateRuleBundle(compiled, sources);
  if (!checked.valid || !checked.bundle) throw new Error(`Reviewed corpus failed validation: ${JSON.stringify(checked.errors)}`);
  data.verifiedRules = checked.bundle.rules; data.ruleLogic = checked.bundle.ruleLogic;
  let automatedChunks = 0;
  try {
    for (const file of await readdir(resolve(process.cwd(), "corpus/extractions"))) {
      if (file.startsWith("run-") || !file.endsWith(".json")) continue;
      const cached = JSON.parse(await readFile(resolve(process.cwd(), "corpus/extractions", file), "utf8"));
      const source = sources.find(source => source.doc_id === cached.result?.doc_id);
      if (source && cached.result?.source_sha256 === source.sha256 && cached.result?.requires_review === true) automatedChunks++;
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  data.corpusAudit = { revision: createHash("sha256").update(JSON.stringify(checked.bundle)).digest("hex"), method: "Claude extraction drafts plus agent-assisted source, date and exemption audit; not a professional legal review", human_legal_review: false, automated_chunks: automatedChunks, captured_sources_used: new Set(data.verifiedRules.flatMap(rule => [rule.source_doc_id, ...(rule.supporting_source_doc_ids ?? [])])).size, rules_by_state: Object.fromEntries(["CA", "NJ", "MA"].map(state => [state, data.verifiedRules.filter(rule => rule.level === "state" ? rule.jurisdiction === state : rule.jurisdiction.endsWith(`, ${state}`)).length])) };
}
try { data.jurisdictionResolutions = JSON.parse(await readFile(resolve(process.cwd(), "corpus/jurisdiction-resolutions.json"), "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
await mkdir(resolve(process.cwd(), "src/data"), { recursive: true });
await writeFile(resolve(process.cwd(), "src/data/challenge.json"), JSON.stringify(data));
console.log(`Built ${properties.length} properties, ${sources.length} sources (${sources.filter(s => s.captured).length} captured), ${data.verifiedRules.length} source-reviewed rules, ${Object.keys(data.jurisdictionResolutions ?? {}).length} municipality matches and ${data.changeFixtures.length} change fixtures.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
