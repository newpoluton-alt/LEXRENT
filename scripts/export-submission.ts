import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { challengeData, exportSubmissions, getCoverageReport, evaluateChanges } from "../src/domain";
import { DEFAULT_AS_OF, type DomainContext } from "../src/domain/types";
import { validateRuleBundle } from "../src/domain/validation";

export class SubmissionExportError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SubmissionExportError"; }
}
export interface SubmissionExportOptions { outputDir: string; methodNote: string }
const HELP = `LEXRENT challenge submission export (local compiled corpus only)
Usage: npm run data:export
       npm run data:export -- --output-dir submissions
Writes rules.json, lookups.json (all 500 addresses), changes.json, readiness.json
and data-coverage.json at the challenge default query date 2026-10-01.
Copies docs/method-note.md when present. No database, credentials or model calls.
Readiness does not certify complete legal coverage; evaluated results are kept
separate from fixture expectations in the supplemental coverage audit.`;

export function parseSubmissionExportArgs(args: readonly string[], cwd = process.cwd()): SubmissionExportOptions | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  const options = { outputDir: resolve(cwd, "submissions"), methodNote: resolve(cwd, "docs/method-note.md") };
  if (args.length === 0) return options;
  if (args.length !== 2 || args[0] !== "--output-dir" || !args[1] || args[1].startsWith("--")) throw new SubmissionExportError("SUBMISSION_INVALID_ARGUMENT");
  options.outputDir = resolve(cwd, args[1]);
  return options;
}

export function buildLocalSubmission() {
  const sources = challengeData.sources;
  for (const source of sources.filter(source => source.captured)) {
    if (!source.text || createHash("sha256").update(source.text).digest("hex") !== source.sha256) throw new SubmissionExportError("SUBMISSION_CAPTURE_HASH_MISMATCH");
  }
  const checked = validateRuleBundle({ rules: challengeData.verifiedRules, ruleLogic: challengeData.ruleLogic ?? {} }, sources);
  if (!checked.valid || !checked.bundle) throw new SubmissionExportError("SUBMISSION_INVALID_RULE_BUNDLE");
  const context: DomainContext = { rules: checked.bundle.rules, ruleLogic: checked.bundle.ruleLogic, sources, jurisdictionResolutions: challengeData.jurisdictionResolutions ?? {} };
  const exports = exportSubmissions(DEFAULT_AS_OF, context);
  const ids = new Set(challengeData.properties.map(property => property.address_id));
  const lookupIds = Object.keys(exports.lookups.lookups);
  if (ids.size !== 500 || lookupIds.length !== 500 || lookupIds.some(id => !ids.has(id))) throw new SubmissionExportError("SUBMISSION_INCOMPLETE_ADDRESSES");
  const ruleIds = new Set(exports.rules.rules.map(rule => rule.team_rule_id));
  if (Object.values(exports.lookups.lookups).some(entries => entries.some(entry => !ruleIds.has(entry.team_rule_id)))) throw new SubmissionExportError("SUBMISSION_INVALID_RULE_REFERENCE");
  const caseIds = ["T1", "T2", "T3", "T4", "T5"];
  if (Object.keys(exports.changes).length !== 5 || caseIds.some(id => !Object.hasOwn(exports.changes, id)) || Object.values(exports.changes).some(item => [...item.affected_address_ids, ...item.conflict_flag_address_ids].some(id => !ids.has(id)))) throw new SubmissionExportError("SUBMISSION_INVALID_CHANGE_SET");
  const usedDocs = new Set(exports.rules.rules.flatMap(rule => [rule.source_doc_id, ...(rule.supporting_source_doc_ids ?? [])]));
  return {
    // Preserve the participant templates' exact top-level wrappers.
    "rules.json": exports.rules,
    "lookups.json": exports.lookups,
    "changes.json": exports.changes,
    "readiness.json": { ...exports.readiness, coverage_complete: false, scope: "local_compiled_corpus", definition: "ready means at least one rule exists and all five change cases have evaluation_status evaluated. It does not certify complete coverage or resolve every missing property fact." },
    "data-coverage.json": {
      ...getCoverageReport(context), export_scope: "local_compiled_corpus", compiled_at: challengeData.generated_at,
      source_provenance: sources.filter(source => usedDocs.has(source.doc_id)).map(source => ({ doc_id: source.doc_id, source_url: source.url, retrieved_at: source.retrieved_at, sha256: source.sha256, manifest_sha256: source.manifest_sha256 ?? null, captured: source.captured })),
      ruleLogic: checked.bundle.ruleLogic,
      change_evaluations: evaluateChanges(context),
      validation_warnings: checked.warnings,
      note: "These files use compiled sources and reviewed Census/official parcel municipality evidence, without live database overrides or user-supplied scenario facts. Fixture expectations are not source evidence. Readiness and recorded-rule availability are distinct from complete legal coverage.",
    },
  };
}
export type LocalSubmission = ReturnType<typeof buildLocalSubmission>;

export async function writeLocalSubmission(files: LocalSubmission, options: SubmissionExportOptions) {
  // Read the optional note before creating output; every JSON payload is validated above.
  let methodNote: string | null = null;
  try { methodNote = await readFile(options.methodNote, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new SubmissionExportError("SUBMISSION_METHOD_NOTE_UNAVAILABLE"); }
  await mkdir(options.outputDir, { recursive: true });
  const written: string[] = [];
  async function save(filename: string, contents: string) {
    const destination = join(options.outputDir, filename), temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, contents);
    await rename(temporary, destination);
    written.push(filename);
  }
  for (const [filename, data] of Object.entries(files)) await save(filename, JSON.stringify(data, null, 2) + "\n");
  if (methodNote !== null) await save("method-note.md", methodNote);
  return { output_directory: options.outputDir, written_files: written, query_date: DEFAULT_AS_OF, evaluated_addresses: Object.keys(files["lookups.json"].lookups).length, rules: files["rules.json"].rules.length, ready: files["readiness.json"].ready, coverage_complete: false, method_note_copied: methodNote !== null, database_accessed: false };
}

async function main() {
  const options = parseSubmissionExportArgs(process.argv.slice(2));
  if (!options) { console.info(HELP); return; }
  console.info(JSON.stringify(await writeLocalSubmission(buildLocalSubmission(), options), null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => { console.error(JSON.stringify({ error_code: error instanceof SubmissionExportError ? error.code : "SUBMISSION_EXPORT_FAILED", database_accessed: false })); process.exitCode = 1; });
}
