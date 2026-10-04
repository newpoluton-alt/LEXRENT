import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import type { ChallengeData, PropertyRecord, SourceDocument } from "../src/domain/types";
import { validateKnowledgeBaseChunks } from "../src/domain/retrieval-index";

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
const data: ChallengeData = { generated_at: new Date().toISOString(), properties, sources, changeFixtures: JSON.parse(await readFile(resolve(root, "dev/change_tests.json"), "utf8")), verifiedRules: [] };
try {
  const records = (await readFile(resolve(process.cwd(), "AI capabilities/rag_knowledge_base.jsonl"), "utf8")).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>);
  const knowledge = validateKnowledgeBaseChunks(records, sources);
  data.knowledgeBaseChunks = knowledge.chunks;
  data.knowledgeBaseAudit = knowledge.audit;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await mkdir(resolve(process.cwd(), "src/data"), { recursive: true });
await writeFile(resolve(process.cwd(), "src/data/challenge.json"), JSON.stringify(data));
console.log(`Built ${properties.length} properties, ${sources.length} sources (${sources.filter(s => s.captured).length} captured), ${data.changeFixtures.length} change fixtures. No legal rules seeded.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
