import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ChallengeData, RuleBundle, RuleRecord, SourceDocument } from "../../src/domain/types";
import { validateRuleBundle } from "../../src/domain/validation";
import fixtures from "../../participant-final-no-hour16 3/dev/change_tests.json";
import { canonicalJson, CORPUS_ACTOR, parsePublicationArgs, prepareCorpusPublication, type DraftArtifact } from "../../scripts/publish-corpus";

// Public presentation fixtures never seed production rules or contact a database.
const database = vi.hoisted(() => ({ get: vi.fn(() => { throw new Error("Database access is forbidden in preflight tests."); }) }));
vi.mock("../../src/server/db", () => ({ getDatabase: database.get }));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const text = "Synthetic publication test evidence only. This sentence is not legal authority and is never published.";

function makeInput(): { data: ChallengeData; artifacts: DraftArtifact[] } {
  const sources: SourceDocument[] = ["CA", "NJ", "MA"].map((state, index) => ({ doc_id: `D00${index + 1}`, jurisdictions: state, url: `https://example.invalid/${state}`, source_type: "test", capture: "yes", retrieved_at: "2026-10-01T12:00Z", sha256: sha(text), text_file: `${state}.txt`, status: "test", captured: true, text }));
  const rules: RuleRecord[] = sources.map((source, index) => ({ team_rule_id: `TEST-${index}`, jurisdiction: source.jurisdictions, level: "state", category: "security_deposits", status: "in_force", title: `Synthetic ${index}`, requirement: "Synthetic test-only requirement", citation: `Test reference ${index}`, source_doc_id: source.doc_id, source_url: source.url, quoted_span: text, effective_date: "2020-01-01" }));
  const ruleLogic: RuleBundle["ruleLogic"] = Object.fromEntries(rules.map(rule => [rule.team_rule_id, { coverage: { field: "residential_use", op: "eq", value: true } }]));
  const data: ChallengeData = {
    generated_at: "2026-10-01T12:00:00Z", sources, verifiedRules: rules, ruleLogic, jurisdictionResolutions: {}, changeFixtures: fixtures as ChallengeData["changeFixtures"],
    properties: Array.from({ length: 500 }, (_, index) => {
      const state = index < 250 ? "CA" : index < 390 ? "NJ" : "MA";
      const city = state === "CA" ? "Los Angeles" : state === "NJ" ? "Jersey City" : "Cambridge";
      return { address_id: `A${String(index + 1).padStart(4, "0")}`, street_address: `${index + 1} Test Street`, postal_city: city, state, zip: "", year_built: null, units: 3, use_code: "TEST", use_description: "Test only", source_dataset: "Synthetic test fixture", retrieved_at: "2026-10-01T12:00:00Z", legal_city_candidate: city, jurisdiction_status: "unresolved", missing_facts: ["year_built", "legal_municipality"], quality_flags: [] };
    }),
    corpusAudit: { revision: sha(JSON.stringify({ rules, ruleLogic })), method: "Synthetic source audit for tests", human_legal_review: false, automated_chunks: 3, captured_sources_used: 3, rules_by_state: { CA: 1, NJ: 1, MA: 1 } },
  };
  const artifacts = sources.map((source, index) => {
    const model = "claude-sonnet-5-5", prompt = index === 0 ? "lexrent-extraction-v2" : "lexrent-extraction-v3";
    const key = sha(JSON.stringify([prompt, model, source.doc_id, source.url, source.sha256, 0]));
    return { filename: `${key}.json`, content: JSON.stringify({ schema_version: 1, cache_key: key, source_url: source.url, result: { doc_id: source.doc_id, source_sha256: source.sha256, model, prompt_version: prompt, chunk: 0, total_chunks: 1, chunk_start: 0, chunk_end: text.length, requires_review: true, created_at: "2026-10-01T12:00:00Z", bundle: { rules: [rules[index]], ruleLogic: { [rules[index].team_rule_id]: ruleLogic[rules[index].team_rule_id] } } } }) };
  });
  syncAudit(data);
  return { data, artifacts };
}
function syncAudit(data: ChallengeData) {
  const checked = validateRuleBundle({ rules: data.verifiedRules, ruleLogic: data.ruleLogic }, data.sources);
  if (checked.bundle) { data.verifiedRules = checked.bundle.rules; data.ruleLogic = checked.bundle.ruleLogic; }
  data.corpusAudit!.revision = sha(JSON.stringify({ rules: data.verifiedRules, ruleLogic: data.ruleLogic }));
  data.corpusAudit!.captured_sources_used = new Set(data.verifiedRules.map(rule => rule.source_doc_id)).size;
  data.corpusAudit!.rules_by_state = Object.fromEntries(["CA", "NJ", "MA"].map(state => [state, data.verifiedRules.filter(rule => rule.level === "state" ? rule.jurisdiction === state : rule.jurisdiction.endsWith(`, ${state}`)).length]));
}

describe("controlled corpus publication preflight", () => {
  it("defaults to a local read-only plan and requires a single explicit publication option", () => {
    expect(parsePublicationArgs([], "/test")?.publish).toBe(false);
    expect(parsePublicationArgs(["--plan"], "/test")?.publish).toBe(false);
    expect(parsePublicationArgs(["--publish"], "/test")?.publish).toBe(true);
    expect(parsePublicationArgs(["--input", "src/data/challenge.json"], "/test")?.input).toBe("/test/src/data/challenge.json");
    for (const args of [["--publish", "--plan"], ["--publish", "--publish"], ["--input"], ["--force"], ["--actor", "admin"]]) expect(() => parsePublicationArgs(args)).toThrow("PUBLICATION_INVALID_ARGUMENT");
    expect(parsePublicationArgs(["--help"])).toBeNull();
  });

  it("checks every supplied address while keeping availability separate from legal completeness and human review", () => {
    const { data, artifacts } = makeInput();
    const plan = prepareCorpusPublication(data, artifacts);
    expect(plan.report).toMatchObject({ property_count: 500, addresses_with_records: 500, addresses_with_applicable_records: 500, minimum_records_per_address: 1, unresolved_municipalities: 500, actor: CORPUS_ACTOR, human_legal_review: false, coverage_complete: false, automated_chunks: 3 });
    expect(plan.metadata).toMatchObject({ actor: "system:corpus-population", human_legal_review: false, coverage_complete: false, ruleLogic: data.ruleLogic });
    expect(plan.metadata.extraction_audit).toMatchObject({ verified_cached_chunks: 3, extracted_source_count: 3, automated_drafts_require_review: true });
    expect(plan.report.changes).toEqual(expect.arrayContaining([expect.objectContaining({ test_id: "T1", status: "not_evaluated" })]));
    expect(plan.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(database.get).not.toHaveBeenCalled();
  });

  it("fingerprints normalized logic and source metadata, but regenerating only the build timestamp is idempotent", () => {
    const { data, artifacts } = makeInput();
    const first = prepareCorpusPublication(data, artifacts).sha256;
    data.generated_at = "2026-10-04T12:00:00Z";
    expect(prepareCorpusPublication(data, artifacts).sha256).toBe(first);
    data.sources[0].retrieved_at = "2026-10-02T12:00:00Z";
    expect(prepareCorpusPublication(data, artifacts).sha256).not.toBe(first);
    data.sources[0].retrieved_at = "2026-10-01T12:00Z";
    data.ruleLogic!["TEST-0"].coverage = { all: [{ field: "residential_use", op: "eq", value: true }, { field: "state", op: "eq", value: "CA" }] };
    syncAudit(data);
    expect(prepareCorpusPublication(data, artifacts).sha256).not.toBe(first);
    expect(canonicalJson({ b: 2, a: { z: 0, c: 3 } })).toBe(canonicalJson({ a: { c: 3, z: 0 }, b: 2 }));
  });

  it("rejects modified source bytes, unsupported quotes and inaccurate review/provenance claims", () => {
    let input = makeInput();
    input.data.sources[0].text += "Changed capture";
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_CAPTURE_HASH_MISMATCH");
    input = makeInput(); input.data.verifiedRules[0].quoted_span = "A fabricated quotation with no source support."; syncAudit(input.data);
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_INVALID_RULE_BUNDLE");
    input = makeInput(); input.data.corpusAudit!.human_legal_review = true;
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_INVALID_COMPILED_DATA");
    input = makeInput(); input.data.corpusAudit!.automated_chunks = 4;
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_EXTRACTION_AUDIT_MISMATCH");
    input = makeInput(); input.data.corpusAudit!.revision = "0".repeat(64);
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_CORPUS_REVISION_MISMATCH");
  });

  it("requires exactly the original 500 IDs and a state baseline even when city candidates have records", () => {
    let input = makeInput(); input.data.properties[499].address_id = "A0001";
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_INVALID_PROPERTY_SAMPLE");
    input = makeInput(); input.data.verifiedRules[2].level = "city"; input.data.verifiedRules[2].jurisdiction = "Cambridge, MA"; syncAudit(input.data);
    // Drafts remain original automated drafts; source-level review can produce a revised bundle.
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_MISSING_STATE_BASELINE");
    input = makeInput(); input.data.verifiedRules = input.data.verifiedRules.filter(rule => rule.jurisdiction !== "NJ"); delete input.data.ruleLogic!["TEST-1"]; syncAudit(input.data);
    expect(() => prepareCorpusPublication(input.data, input.artifacts)).toThrow("PUBLICATION_EMPTY_PROPERTY_RESULT");
  });

  it("rejects draft identities that no longer match their chunks and never promotes a draft's review flag", () => {
    const { data, artifacts } = makeInput();
    let altered = JSON.parse(artifacts[0].content); altered.result.chunk_end--;
    const changed = [{ ...artifacts[0], content: JSON.stringify(altered) }, ...artifacts.slice(1)];
    expect(() => prepareCorpusPublication(data, changed)).toThrow("PUBLICATION_INVALID_DRAFT_IDENTITY");
    altered = JSON.parse(artifacts[0].content); altered.result.requires_review = false;
    changed[0].content = JSON.stringify(altered);
    expect(() => prepareCorpusPublication(data, changed)).toThrow("PUBLICATION_INVALID_DRAFT_ARTIFACT");
  });

  it("accepts exact official municipality provenance and rejects inconsistent state or street seeds", () => {
    const { data, artifacts } = makeInput();
    data.jurisdictionResolutions!.A0001 = { state: "CA", legal_city: "Los Angeles", verified: true, method: "census_geographies", resolved_at: "2026-10-04T12:00:00Z", municipality_id: "0644000", source_url: "https://geocoding.geo.census.gov/geocoder/geographies/address?street=1+Test+Street&state=CA" };
    expect(prepareCorpusPublication(data, artifacts).report.jurisdiction_seeds).toBe(1);
    data.jurisdictionResolutions!.A0001.state = "NJ";
    expect(() => prepareCorpusPublication(data, artifacts)).toThrow("PUBLICATION_INVALID_JURISDICTION_SEED");
    data.jurisdictionResolutions!.A0001.state = "CA";
    data.jurisdictionResolutions!.A0001.source_url = "https://geocoding.geo.census.gov/geocoder/geographies/address?street=2+Different+Street&state=CA";
    expect(() => prepareCorpusPublication(data, artifacts)).toThrow("PUBLICATION_INVALID_JURISDICTION_SEED");
    expect(database.get).not.toHaveBeenCalled();
  });
});

describe("captured parcel publication provenance", () => {
  // Public immutable captures only; this exercises the full compiled corpus without a live database.
  const compiled = JSON.parse(readFileSync(resolve("src/data/challenge.json"), "utf8")) as ChallengeData;
  const cacheDir = resolve("corpus/extractions");
  const artifacts = readdirSync(cacheDir).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).map(filename => ({ filename, content: readFileSync(join(cacheDir, filename), "utf8") }));
  const evidence = { snapshot: readFileSync(resolve("corpus/nj-parcel-evidence.json"), "utf8"), providerResponse: readFileSync(resolve("corpus/nj-parcel-provider-response.json"), "utf8") };

  it("recomputes the two public captures for all 47 manual seeds before accepting the compiled baseline", () => {
    const plan = prepareCorpusPublication(compiled, artifacts, evidence);
    expect(plan.report).toMatchObject({ jurisdiction_seeds: 447, unresolved_municipalities: 53, rule_count: 95, property_count: 500, coverage_complete: false, human_legal_review: false });
    expect(plan.metadata.jurisdiction_parcel_audit).toMatchObject({ reviewed_municipality_count: 47, capture_sha256: sha(evidence.snapshot), provider_response_sha256: sha(evidence.providerResponse) });
    expect(database.get).not.toHaveBeenCalled();
  });

  it("requires the actual capture and rejects changed original provider bytes or edited selected attributes", () => {
    expect(() => prepareCorpusPublication(compiled, artifacts)).toThrow("PUBLICATION_PARCEL_CAPTURE_UNAVAILABLE");
    expect(() => prepareCorpusPublication(compiled, artifacts, { ...evidence, providerResponse: evidence.providerResponse + "\n" })).toThrow("PUBLICATION_INVALID_PARCEL_CAPTURE");
    const selected = JSON.parse(evidence.snapshot); selected.entries[0].attributes.PROP_LOC = "1 DIFFERENT ST";
    expect(() => prepareCorpusPublication(compiled, artifacts, { ...evidence, snapshot: JSON.stringify(selected) })).toThrow("PUBLICATION_INVALID_PARCEL_CAPTURE");
    expect(database.get).not.toHaveBeenCalled();
  });

  it("rejects a structurally valid but unaudited resolution or forged capture fingerprint", () => {
    const changed = structuredClone(compiled), id = Object.keys(changed.jurisdictionResolutions!).find(id => changed.jurisdictionResolutions![id].method === "manual_review")!;
    changed.jurisdictionResolutions![id].note = "This statement was never present in the source-backed review.";
    expect(() => prepareCorpusPublication(changed, artifacts, evidence)).toThrow("PUBLICATION_PARCEL_RESOLUTION_MISMATCH");
    changed.jurisdictionResolutions![id] = structuredClone(compiled.jurisdictionResolutions![id]);
    changed.jurisdictionResolutions![id].parcel_evidence!.capture_sha256 = "0".repeat(64);
    expect(() => prepareCorpusPublication(changed, artifacts, evidence)).toThrow("PUBLICATION_PARCEL_RESOLUTION_MISMATCH");
    expect(database.get).not.toHaveBeenCalled();
  });
});
