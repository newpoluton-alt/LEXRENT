import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { ChallengeData, JurisdictionResolution, RuleBundle, SourceDocument } from "../src/domain/types";
import { DEFAULT_AS_OF } from "../src/domain/types";
import { evaluatePropertyRecord } from "../src/domain/evaluator";
import { evaluateChangeCases } from "../src/domain/changes";
import { validateRuleBundle } from "../src/domain/validation";
import { chunkSourceText } from "../src/server/ai";
import { getDatabase } from "../src/server/db";
import { validResolution } from "./enrich-jurisdictions";
import { reviewNjParcelSnapshot } from "./review-nj-parcels";

export const CORPUS_ACTOR = "system:corpus-population";
const METHOD = "Claude extraction drafts plus agent-assisted source, date and exemption audit; not a professional legal review";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export class PublicationError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "PublicationError"; }
}
export interface PublicationOptions { publish: boolean; input: string; cacheDir: string; parcelInput: string; parcelResponse: string }
export interface ParcelPublicationEvidence { snapshot: string; providerResponse: string }
export interface DraftArtifact { filename: string; content: string }
export interface PublicationPreflight {
  bundle: RuleBundle;
  metadata: Record<string, unknown>;
  sha256: string;
  resolutions: Record<string, JurisdictionResolution>;
  report: Record<string, unknown>;
}
const HELP = `LEXRENT controlled local corpus publication
Usage: node --import tsx scripts/publish-corpus.ts [--plan]
       node --import tsx scripts/publish-corpus.ts --publish
--plan       Default: validate local compiled data and drafts, without database access or writes.
--publish    Explicitly add a validated immutable rule version and missing jurisdiction seeds.
--input      Default src/data/challenge.json.
--cache-dir  Default corpus/extractions.
--parcel-input     Default corpus/nj-parcel-evidence.json.
--parcel-response  Default corpus/nj-parcel-provider-response.json.
Existing rule versions and all existing administrator jurisdiction records are preserved.
Publication is an agent-assisted source audit; human_legal_review is always false.`;

export function parsePublicationArgs(args: readonly string[], cwd = process.cwd()): PublicationOptions | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  const options = { publish: false, input: resolve(cwd, "src/data/challenge.json"), cacheDir: resolve(cwd, "corpus/extractions"), parcelInput: resolve(cwd, "corpus/nj-parcel-evidence.json"), parcelResponse: resolve(cwd, "corpus/nj-parcel-provider-response.json") };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new PublicationError("PUBLICATION_INVALID_ARGUMENT");
    seen.add(flag);
    if (flag === "--publish" || flag === "--plan") {
      if (seen.has(flag === "--publish" ? "--plan" : "--publish")) throw new PublicationError("PUBLICATION_INVALID_ARGUMENT");
      options.publish = flag === "--publish"; continue;
    }
    if (!["--input", "--cache-dir", "--parcel-input", "--parcel-response"].includes(flag)) throw new PublicationError("PUBLICATION_INVALID_ARGUMENT");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new PublicationError("PUBLICATION_INVALID_ARGUMENT");
    if (flag === "--input") options.input = resolve(cwd, value);
    else if (flag === "--cache-dir") options.cacheDir = resolve(cwd, value);
    else if (flag === "--parcel-input") options.parcelInput = resolve(cwd, value);
    else options.parcelResponse = resolve(cwd, value);
  }
  return options;
}

/** Sorted object keys make fingerprints stable across serialization, without rewriting array semantics. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

const propertySchema = z.object({
  address_id: z.string().regex(/^A\d{4}$/), street_address: z.string().min(1), postal_city: z.string(), state: z.enum(["CA", "NJ", "MA"]), zip: z.string(),
  year_built: z.number().nullable(), units: z.number().nullable(), use_code: z.string(), use_description: z.string(), source_dataset: z.string(), retrieved_at: z.string(),
  legal_city_candidate: z.string(), jurisdiction_status: z.literal("unresolved"), missing_facts: z.array(z.string()), quality_flags: z.array(z.string()),
}).passthrough();
const sourceSchema = z.object({
  doc_id: z.string().regex(/^[DS]\d{3}$/), url: z.url().refine(value => ["https:", "http:"].includes(new URL(value).protocol)),
  jurisdictions: z.string(), source_type: z.string(), capture: z.string(), retrieved_at: z.string(), sha256: z.string(), text_file: z.string(), status: z.string(), captured: z.boolean(), text: z.string().optional(), manifest_sha256: z.string().optional(),
}).passthrough();
const inputSchema = z.object({
  generated_at: z.string(), properties: z.array(propertySchema).length(500), sources: z.array(sourceSchema).min(1),
  verifiedRules: z.array(z.unknown()).min(1), ruleLogic: z.record(z.string(), z.unknown()), jurisdictionResolutions: z.record(z.string(), z.unknown()), changeFixtures: z.array(z.unknown()).length(5),
  corpusAudit: z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), method: z.string().min(1), human_legal_review: z.literal(false), automated_chunks: z.number().int().positive(), captured_sources_used: z.number().int().positive(), rules_by_state: z.record(z.string(), z.number().int().nonnegative()) }).passthrough(),
}).passthrough();
const artifactSchema = z.object({
  schema_version: z.literal(1), cache_key: z.string().regex(/^[a-f0-9]{64}$/), source_url: z.url(),
  result: z.object({ doc_id: z.string(), source_sha256: z.string(), model: z.string().min(1).max(100), prompt_version: z.string().regex(/^lexrent-extraction-v\d+$/), chunk: z.number().int().nonnegative(), total_chunks: z.number().int().positive(), chunk_start: z.number().int().nonnegative(), chunk_end: z.number().int().positive(), requires_review: z.literal(true), created_at: z.string(), bundle: z.unknown() }).passthrough(),
}).strict();

function extractionAudit(artifacts: readonly DraftArtifact[], sources: readonly SourceDocument[]) {
  const valid: { cache_key: string; artifact_sha256: string; doc_id: string; source_sha256: string; model: string; prompt_version: string; chunk: number; draft_rule_count: number }[] = [];
  const seen = new Set<string>();
  let stale = 0;
  for (const artifact of artifacts) {
    let input: unknown;
    try { input = JSON.parse(artifact.content); } catch { throw new PublicationError("PUBLICATION_INVALID_DRAFT_ARTIFACT"); }
    const parsed = artifactSchema.safeParse(input);
    if (!parsed.success) throw new PublicationError("PUBLICATION_INVALID_DRAFT_ARTIFACT");
    const { result, cache_key, source_url } = parsed.data;
    const source = sources.find(source => source.doc_id === result.doc_id);
    if (!source || !source.captured || source.sha256 !== result.source_sha256) { stale++; continue; }
    const chunks = chunkSourceText(source.text!), chunk = chunks[result.chunk];
    const expected = sha(JSON.stringify([result.prompt_version, result.model, result.doc_id, source.url, source.sha256, result.chunk]));
    if (seen.has(cache_key) || artifact.filename !== `${cache_key}.json` || cache_key !== expected || source_url !== source.url || !chunk || result.total_chunks !== chunks.length || result.chunk_start !== chunk.start || result.chunk_end !== chunk.end || !Number.isFinite(Date.parse(result.created_at))) throw new PublicationError("PUBLICATION_INVALID_DRAFT_IDENTITY");
    const checked = validateRuleBundle(result.bundle, [source]);
    if (!checked.valid || !checked.bundle || checked.bundle.rules.some(rule => !chunk.text.includes(rule.quoted_span))) throw new PublicationError("PUBLICATION_INVALID_DRAFT_EVIDENCE");
    seen.add(cache_key);
    valid.push({ cache_key, artifact_sha256: sha(artifact.content), doc_id: result.doc_id, source_sha256: source.sha256, model: result.model, prompt_version: result.prompt_version, chunk: result.chunk, draft_rule_count: checked.bundle.rules.length });
  }
  return { verified_cached_chunks: valid.length, extracted_source_count: new Set(valid.map(item => item.doc_id)).size, stale_cache_artifacts: stale, automated_drafts_require_review: true, records: valid.sort((a, b) => a.cache_key.localeCompare(b.cache_key)), note: "Source-validated local automated draft artifacts; source-level extraction coverage does not claim every published requirement was produced unchanged by Claude." };
}

export function prepareCorpusPublication(input: unknown, artifacts: readonly DraftArtifact[], parcelEvidence?: ParcelPublicationEvidence): PublicationPreflight {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new PublicationError("PUBLICATION_INVALID_COMPILED_DATA");
  const data = parsed.data as unknown as ChallengeData;
  const propertyIds = new Set(data.properties.map(property => property.address_id));
  if (propertyIds.size !== 500 || Array.from({ length: 500 }, (_, index) => `A${String(index + 1).padStart(4, "0")}`).some(id => !propertyIds.has(id))) throw new PublicationError("PUBLICATION_INVALID_PROPERTY_SAMPLE");
  if (new Set(data.sources.map(source => source.doc_id)).size !== data.sources.length) throw new PublicationError("PUBLICATION_DUPLICATE_SOURCE");
  for (const source of data.sources.filter(source => source.captured)) if (!source.text?.trim() || source.sha256 !== sha(source.text) || !Number.isFinite(Date.parse(source.retrieved_at))) throw new PublicationError("PUBLICATION_CAPTURE_HASH_MISMATCH");
  const checked = validateRuleBundle({ rules: data.verifiedRules, ruleLogic: data.ruleLogic }, data.sources);
  if (!checked.valid || !checked.bundle) throw new PublicationError("PUBLICATION_INVALID_RULE_BUNDLE");
  const bundle = checked.bundle;
  const rawRevision = sha(JSON.stringify(bundle));
  if (data.corpusAudit!.revision !== rawRevision) throw new PublicationError("PUBLICATION_CORPUS_REVISION_MISMATCH");
  const extraction = extractionAudit(artifacts, data.sources);
  if (!extraction.verified_cached_chunks || extraction.verified_cached_chunks !== data.corpusAudit!.automated_chunks) throw new PublicationError("PUBLICATION_EXTRACTION_AUDIT_MISMATCH");
  const usedSources = new Set(bundle.rules.flatMap(rule => [rule.source_doc_id, ...(rule.supporting_source_doc_ids ?? [])]));
  if (usedSources.size !== data.corpusAudit!.captured_sources_used) throw new PublicationError("PUBLICATION_SOURCE_AUDIT_MISMATCH");
  const resolutions = data.jurisdictionResolutions!;
  const properties = new Map(data.properties.map(property => [property.address_id, property]));
  for (const [id, resolution] of Object.entries(resolutions)) if (!properties.has(id) || !validResolution(resolution, properties.get(id)!)) throw new PublicationError("PUBLICATION_INVALID_JURISDICTION_SEED");
  const parcelResolutions = Object.entries(resolutions).filter(([, resolution]) => resolution.method === "manual_review");
  let parcelAudit: Record<string, unknown> | null = null;
  if (parcelResolutions.length) {
    if (!parcelEvidence) throw new PublicationError("PUBLICATION_PARCEL_CAPTURE_UNAVAILABLE");
    let reviewed;
    try { reviewed = reviewNjParcelSnapshot(parcelEvidence.snapshot, data.properties, parcelEvidence.providerResponse); }
    catch { throw new PublicationError("PUBLICATION_INVALID_PARCEL_CAPTURE"); }
    if (reviewed.rejected.length || parcelResolutions.some(([id, resolution]) => !reviewed.resolutions[id] || canonicalJson(reviewed.resolutions[id]) !== canonicalJson(resolution))) throw new PublicationError("PUBLICATION_PARCEL_RESOLUTION_MISMATCH");
    parcelAudit = { capture_sha256: reviewed.capture_sha256, provider_response_sha256: reviewed.provider_response_sha256, captured_at: reviewed.captured_at, reviewed_municipality_count: parcelResolutions.length, method: "Exact complete-address match to official NJOGIS municipal tax parcel records; not surveyed or historical boundary proof." };
  }
  const context = { rules: bundle.rules, ruleLogic: bundle.ruleLogic, sources: data.sources, jurisdictionResolutions: resolutions };
  const evaluations = data.properties.map(property => evaluatePropertyRecord(property, DEFAULT_AS_OF, context, data.sources));
  if (evaluations.some(item => !item.rules.length)) throw new PublicationError("PUBLICATION_EMPTY_PROPERTY_RESULT");
  if (evaluations.some(item => !item.rules.some(entry => entry.rule.level === "state"))) throw new PublicationError("PUBLICATION_MISSING_STATE_BASELINE");
  const byState = Object.fromEntries(["CA", "NJ", "MA"].map(state => {
    const items = evaluations.filter(item => item.property.state === state);
    return [state, { addresses: items.length, with_records: items.filter(item => item.rules.length).length, with_applicable: items.filter(item => item.rules.some(entry => entry.result === "applies")).length, verified_municipalities: items.filter(item => item.jurisdiction.verified).length, rules: bundle.rules.filter(rule => rule.level === "state" ? rule.jurisdiction === state : rule.jurisdiction.endsWith(`, ${state}`)).length }];
  }));
  if (Object.entries(byState).some(([state, counts]) => counts.rules !== data.corpusAudit!.rules_by_state[state])) throw new PublicationError("PUBLICATION_STATE_AUDIT_MISMATCH");
  const metadata = {
    schema_version: 1, actor: CORPUS_ACTOR, method: METHOD, human_legal_review: false, coverage_complete: false,
    ruleLogic: bundle.ruleLogic, corpus_revision: rawRevision, extraction_audit: extraction,
    capture_hash_map: Object.fromEntries(data.sources.filter(source => source.captured).sort((a, b) => a.doc_id.localeCompare(b.doc_id)).map(source => [source.doc_id, { sha256: source.sha256, manifest_sha256: source.manifest_sha256 ?? null, source_url: source.url, retrieved_at: source.retrieved_at }])),
    property_snapshot_sha256: sha(canonicalJson([...data.properties].sort((a, b) => a.address_id.localeCompare(b.address_id)))),
    jurisdiction_seed_sha256: sha(canonicalJson(resolutions)), jurisdiction_seed_count: Object.keys(resolutions).length,
    jurisdiction_parcel_audit: parcelAudit,
    source_review: { captured_sources_used: usedSources.size, rules_by_state: Object.fromEntries(Object.entries(byState).map(([state, counts]) => [state, counts.rules])) },
  };
  const rulesJson = canonicalJson(bundle.rules), metadataJson = canonicalJson(metadata);
  const fingerprint = sha(`${rulesJson}\n${metadataJson}`);
  const changes = evaluateChangeCases(data.changeFixtures, data.properties, data.sources, context);
  return { bundle, metadata, sha256: fingerprint, resolutions, report: {
    actor: CORPUS_ACTOR, human_legal_review: false, coverage_complete: false, as_of: DEFAULT_AS_OF, bundle_sha256: fingerprint, corpus_revision: rawRevision,
    rule_count: bundle.rules.length, captured_sources: data.sources.filter(source => source.captured).length, captured_sources_used: usedSources.size,
    automated_chunks: extraction.verified_cached_chunks, automated_sources: extraction.extracted_source_count, property_count: evaluations.length,
    addresses_with_records: evaluations.filter(item => item.rules.length).length, addresses_with_applicable_records: evaluations.filter(item => item.rules.some(entry => entry.result === "applies")).length,
    minimum_records_per_address: Math.min(...evaluations.map(item => item.rules.length)), jurisdiction_seeds: Object.keys(resolutions).length, unresolved_municipalities: evaluations.filter(item => !item.jurisdiction.verified).length,
    by_state: byState, changes: changes.map(change => ({ test_id: change.test_id, status: change.evaluation_status, expected_addresses: change.expected_address_count, evaluated_affected: change.affected_address_ids.length, unresolved_addresses: change.unresolved_address_ids.length, missing_rule_ids: change.missing_rule_ids })), warnings: checked.warnings,
    note: "Counts describe the local compiled baseline; existing database administrator captures and jurisdiction overrides are preserved and may produce different live results. Recorded-rule availability does not certify complete legal coverage.",
  } };
}

/** One local, explicit publication transaction; no web-admin session is fabricated. */
export async function publishPreparedCorpus(prepared: PublicationPreflight) {
  try {
    const sql = getDatabase();
    const results = await sql.transaction([
      sql.query("SELECT pg_advisory_xact_lock($1)", [197506]),
      sql.query(`INSERT INTO lexrent_rule_bundles (name, source_file, sha256, rules, metadata, verified_by_user_id)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6) ON CONFLICT (sha256) DO NOTHING RETURNING id`,
      [`LEXRENT agent-assisted corpus ${String(prepared.metadata.corpus_revision).slice(0, 12)}`, "src/data/challenge.json", prepared.sha256, canonicalJson(prepared.bundle.rules), canonicalJson(prepared.metadata), CORPUS_ACTOR]),
      sql.query(`WITH supplied AS (SELECT key AS address_id, value AS resolution FROM jsonb_each($1::jsonb)), inserted AS (
        INSERT INTO lexrent_jurisdiction_resolutions (address_id, resolution, verified_by_user_id)
        SELECT address_id, resolution, $2 FROM supplied ON CONFLICT (address_id) DO NOTHING RETURNING address_id
      ) SELECT (SELECT count(*) FROM inserted)::int AS inserted_count, (SELECT count(*) FROM supplied)::int AS supplied_count`, [canonicalJson(prepared.resolutions), CORPUS_ACTOR]),
      sql.query(`INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id, metadata)
        SELECT $1, 'corpus.populate', 'rule_bundle', id::text, $3::jsonb || jsonb_build_object(
          'total_bundle_versions', (SELECT count(*) FROM lexrent_rule_bundles),
          'total_jurisdiction_resolutions', (SELECT count(*) FROM lexrent_jurisdiction_resolutions),
          'existing_overrides_preserved', true)
        FROM lexrent_rule_bundles WHERE sha256 = $2`, [CORPUS_ACTOR, prepared.sha256, canonicalJson(prepared.report)]),
      sql.query(`SELECT id, sha256,
        (SELECT count(*)::int FROM lexrent_rule_bundles) AS total_bundle_versions,
        (SELECT count(*)::int FROM lexrent_jurisdiction_resolutions) AS total_jurisdiction_resolutions,
        (SELECT sha256 FROM lexrent_rule_bundles ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_bundle_sha256
        FROM lexrent_rule_bundles WHERE sha256 = $1`, [prepared.sha256]),
    ]);
    const current = results[4][0];
    if (!current) throw new PublicationError("PUBLICATION_NOT_CONFIRMED");
    return { ...prepared.report, published: true, inserted_bundle_versions: results[1].length, bundle_id: String(current.id), inserted_jurisdictions: Number(results[2][0]?.inserted_count ?? 0), preserved_existing_jurisdictions: Number(results[2][0]?.supplied_count ?? 0) - Number(results[2][0]?.inserted_count ?? 0), total_bundle_versions: Number(current.total_bundle_versions), total_jurisdiction_resolutions: Number(current.total_jurisdiction_resolutions), latest_bundle_is_this_version: current.latest_bundle_sha256 === prepared.sha256 };
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError("PUBLICATION_DATABASE_UNAVAILABLE");
  }
}

async function readArtifacts(directory: string): Promise<DraftArtifact[]> {
  let files: string[];
  try { files = await readdir(directory); } catch { throw new PublicationError("PUBLICATION_EXTRACTION_CACHE_UNAVAILABLE"); }
  return Promise.all(files.filter(filename => /^[a-f0-9]{64}\.json$/.test(filename)).sort().map(async filename => ({ filename, content: await readFile(join(directory, filename), "utf8") })));
}
async function main() {
  const options = parsePublicationArgs(process.argv.slice(2));
  if (!options) { console.info(HELP); return; }
  const [contents, artifacts] = await Promise.all([readFile(options.input, "utf8"), readArtifacts(options.cacheDir)]);
  let input: unknown;
  try { input = JSON.parse(contents); } catch { throw new PublicationError("PUBLICATION_INVALID_COMPILED_DATA"); }
  let parcelEvidence: ParcelPublicationEvidence | undefined;
  if (Object.values((input as ChallengeData).jurisdictionResolutions ?? {}).some(resolution => resolution.method === "manual_review")) {
    try {
      const [snapshot, providerResponse] = await Promise.all([readFile(options.parcelInput, "utf8"), readFile(options.parcelResponse, "utf8")]);
      parcelEvidence = { snapshot, providerResponse };
    } catch { throw new PublicationError("PUBLICATION_PARCEL_CAPTURE_UNAVAILABLE"); }
  }
  const prepared = prepareCorpusPublication(input, artifacts, parcelEvidence);
  if (!options.publish) { console.info(JSON.stringify({ ...prepared.report, plan_only: true, published: false, database_accessed: false }, null, 2)); return; }
  for (const filename of [".env.local", ".env"]) {
    try { loadEnvFile(resolve(process.cwd(), filename)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PublicationError("PUBLICATION_ENV_LOAD_FAILED"); }
  }
  console.info(JSON.stringify(await publishPreparedCorpus(prepared), null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => { console.error(JSON.stringify({ error_code: error instanceof PublicationError ? error.code : "PUBLICATION_FAILED", published: false })); process.exitCode = 1; });
}
