import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PropertyRecord } from "../../src/domain/types";
import { enrichOneJurisdiction, validResolution } from "../../scripts/enrich-jurisdictions";
import { NJ_PARCEL_ENDPOINT, normalizeNjParcelAddress, parseNjParcelReviewArgs, parseNjParcelSnapshot, reviewNjParcelSnapshot, validNjParcelResolution, type NjParcelSnapshot } from "../../scripts/review-nj-parcels";

function property(street = "1031-1035 CLINTON ST"): PropertyRecord {
  return { address_id: "A0002", street_address: street, postal_city: "Hoboken", state: "NJ", zip: "07030", year_built: null, units: null, use_code: "", use_description: "", source_dataset: "synthetic test", retrieved_at: "2026-10-01T00:00:00Z", legal_city_candidate: "Hoboken", jurisdiction_status: "unresolved", missing_facts: ["legal_municipality"], quality_flags: [] };
}
function url(ids: string) {
  const value = new URL(NJ_PARCEL_ENDPOINT);
  value.search = new URLSearchParams({ objectIds: ids, outFields: "OBJECTID,PAMS_PIN,PCL_MUN,CD_CODE,MUN_NAME,PROP_LOC", returnGeometry: "false", f: "json" }).toString();
  return value.toString();
}
function snapshot(street = "1031-1035 CLINTON ST"): NjParcelSnapshot {
  return {
    retrieved_at: "2026-10-04T10:18:52.542Z", official_directory: "https://nj.gov/njgin/edata/parcels/", official_metadata: NJ_PARCEL_ENDPOINT.replace(/\/query$/, ""),
    official_authority: "https://www.nj.gov/housingcouncil/resources/data-dictionaries.shtml", provider_response_sha256: "0".repeat(64),
    query_url: url("1117390"), method: "Exact full parcel location and municipal tax identifiers", limitations: "Tax assignment, not title or historical boundary proof.",
    entries: [{ address_id: "A0002", original_address: street, exact_full_address_match: true, normalization: "Whole address only", municipality_from_tax_record: "HOBOKEN CITY", municipal_code: "0905", tax_code: "0905", parcel: "0905_162_4",
      attributes: { OBJECTID: 1117390, PAMS_PIN: "0905_162_4", PCL_MUN: "0905", CD_CODE: "0905", MUN_NAME: "HOBOKEN CITY", PROP_LOC: street }, source_url: url("1117390") }],
  };
}
function provider(input: NjParcelSnapshot) { return JSON.stringify({ objectIdFieldName: "OBJECTID", features: input.entries.map(entry => ({ attributes: entry.attributes })) }); }
function captured(input: NjParcelSnapshot) { return { ...input, provider_response_sha256: createHash("sha256").update(provider(input)).digest("hex") }; }
const review = (input: NjParcelSnapshot, p = property()) => reviewNjParcelSnapshot(JSON.stringify(captured(input)), [p], provider(input));

describe("strict captured NJ parcel review", () => {
  it("accepts the entire range and fingerprints exact snapshot bytes, retaining its NJ code namespace", () => {
    const p = property(), original = structuredClone(p), input = captured(snapshot()), raw = JSON.stringify(input, null, 2) + "\n";
    const result = reviewNjParcelSnapshot(raw, [p], provider(input));
    expect(result.rejected).toEqual([]);
    expect(result.capture_sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    const resolution = result.resolutions.A0002;
    expect(resolution).toMatchObject({ state: "NJ", legal_city: "Hoboken", verified: true, method: "manual_review", municipality_id: "NJ:0905", parcel_evidence: { PROP_LOC: "1031-1035 CLINTON ST", OBJECTID: 1117390, PAMS_PIN: "0905_162_4", PCL_MUN: "0905", CD_CODE: "0905", MUN_NAME: "HOBOKEN CITY", capture_sha256: result.capture_sha256, captured_at: result.captured_at } });
    expect(validResolution(resolution, p)).toBe(true);
    expect(p).toEqual(original);
    expect(parseNjParcelSnapshot(raw.trim()).capture_sha256).not.toBe(result.capture_sha256);
  });

  it("normalizes only whitespace, case, periods and AVE/AVENUE while preserving numbers/ranges/suffixes", () => {
    expect(normalizeNjParcelAddress(" 1031 - 1035 clinton st. ")).toBe("1031-1035 CLINTON ST");
    expect(normalizeNjParcelAddress("12A NEWARK Avenue.")).toBe("12A NEWARK AVE");
    expect(normalizeNjParcelAddress("38-38-SOMME ST")).toBe("38-38-SOMME ST");
    expect(normalizeNjParcelAddress("12/14 A & B ST")).toBe("12/14 A & B ST");
    expect(normalizeNjParcelAddress("12.14 TEST ST")).toBe("12.14 TEST ST");
    const input = snapshot("12A NEWARK AVE"), p = property("12A NEWARK AVE");
    input.entries[0].attributes.PROP_LOC = "12A  Newark Avenue.";
    expect(Object.keys(review(input, p).resolutions)).toEqual(["A0002"]);
    for (const changed of ["12 NEWARK AVE", "12B NEWARK AVE", "12A NEWARK ST", "1035-1031 CLINTON ST", "1031 CLINTON ST", "1035 CLINTON ST", "1031-1037 CLINTON ST", "1031-1035 CLINTON STREET"]) {
      const bad = snapshot(); bad.entries[0].attributes.PROP_LOC = changed;
      expect(review(bad).resolutions).toEqual({});
    }
  });

  it("rejects conflicting municipal codes or a false municipality label, including redundant capture fields", () => {
    for (const mutate of [
      (s: NjParcelSnapshot) => { s.entries[0].attributes.CD_CODE = "0906"; s.entries[0].tax_code = "0906"; },
      (s: NjParcelSnapshot) => { s.entries[0].attributes.MUN_NAME = "JERSEY CITY"; s.entries[0].municipality_from_tax_record = "JERSEY CITY"; },
      (s: NjParcelSnapshot) => { s.entries[0].municipal_code = "0906"; },
      (s: NjParcelSnapshot) => { s.entries[0].attributes.PAMS_PIN = "0906_162_4"; s.entries[0].parcel = "0906_162_4"; },
    ]) { const input = snapshot(); mutate(input); expect(review(input).resolutions).toEqual({}); }
    const good = review(snapshot()).resolutions.A0002;
    expect(validNjParcelResolution({ ...good, legal_city: "Jersey City" }, property())).toBe(false);
    expect(validNjParcelResolution({ ...good, municipality_id: "3432250" }, property())).toBe(false);
    expect(validNjParcelResolution({ ...good, state: "MA" }, property())).toBe(false);
  });

  it("does not use postal-city hints as evidence when the official full-address tax assignment is valid", () => {
    const p = { ...property(), postal_city: "Wrong postal hint", legal_city_candidate: "Wrong candidate" };
    expect(review(snapshot(), p).resolutions.A0002.legal_city).toBe("Hoboken");
    expect(review(snapshot(), { ...p, state: "MA" }).resolutions).toEqual({});
  });

  it("rejects foreign providers, changed endpoints, multiple object IDs and hidden query selectors", () => {
    const good = review(snapshot()).resolutions.A0002;
    for (const changed of [
      good.source_url.replace("services2.arcgis.com", "services2.arcgis.com.example.invalid"),
      good.source_url.replace("FeatureServer/0/query", "FeatureServer/1/query"),
      good.source_url.replace("https:", "http:"),
      good.source_url.replace("objectIds=1117390", "objectIds=1117390%2C1117391"),
      good.source_url + "&where=1%3D1", good.source_url + "&objectIds=1117391", good.source_url + "#different",
    ]) {
      expect(validNjParcelResolution({ ...good, source_url: changed, parcel_evidence: { ...good.parcel_evidence, source_url: changed } }, property())).toBe(false);
    }
    const invalid = snapshot(); invalid.query_url = invalid.query_url.replace("services2.arcgis.com", "example.invalid");
    expect(() => review(invalid)).toThrow("NJ_PARCEL_INVALID_PROVIDER");
  });

  it("rejects ambiguous multiple parcels even when both claim the same municipality and whole address", () => {
    const input = snapshot(), second = structuredClone(input.entries[0]);
    second.attributes.OBJECTID = 1117391; second.attributes.PAMS_PIN = second.parcel = "0905_162_5"; second.source_url = url("1117391");
    input.entries.push(second); input.query_url = url("1117390,1117391");
    expect(review(input)).toMatchObject({ resolutions: {}, rejected: [{ address_id: "A0002", error_code: "NJ_PARCEL_AMBIGUOUS_MATCH" }] });
    second.address_id = "A0003";
    const both = reviewNjParcelSnapshot(JSON.stringify(captured(input)), [property(), { ...property(), address_id: "A0003" }], provider(input));
    expect(both.resolutions).toEqual({});
    expect(both.rejected).toHaveLength(2);
  });

  it("rejects stale addresses, missing evidence, altered capture hashes and unrecognized codes", () => {
    const input = snapshot(); input.entries[0].original_address = "1031 CLINTON ST";
    expect(review(input)).toMatchObject({ resolutions: {}, rejected: [{ error_code: "NJ_PARCEL_INCONSISTENT_SNAPSHOT" }] });
    const good = review(snapshot()).resolutions.A0002;
    expect(validResolution({ ...good, parcel_evidence: undefined }, property())).toBe(false);
    expect(validResolution({ ...good, resolved_at: "2026-10-05T00:00:00Z" }, property())).toBe(false);
    expect(validResolution({ ...good, parcel_evidence: { ...good.parcel_evidence, capture_sha256: "invented" } }, property())).toBe(false);
    const unknown = snapshot(); unknown.entries[0].attributes.PCL_MUN = unknown.entries[0].attributes.CD_CODE = unknown.entries[0].municipal_code = unknown.entries[0].tax_code = "9999";
    expect(review(unknown).resolutions).toEqual({});
    expect(() => parseNjParcelSnapshot("{}" )).toThrow("NJ_PARCEL_INVALID_SNAPSHOT");
  });

  it("keeps Census range behavior unchanged and defaults the local CLI to a read-only plan", async () => {
    const resolver = vi.fn();
    expect(await enrichOneJurisdiction(property(), resolver)).toMatchObject({ status: "needs_review", attempts: [] });
    expect(resolver).not.toHaveBeenCalled();
    expect(parseNjParcelReviewArgs([], "/tmp/test")).toEqual({ snapshot: "/tmp/test/corpus/nj-parcel-evidence.json", providerResponse: "/tmp/test/corpus/nj-parcel-provider-response.json", outputDir: "/tmp/test/corpus", write: false });
    expect(parseNjParcelReviewArgs(["--write"], "/tmp/test")?.write).toBe(true);
    expect(() => parseNjParcelReviewArgs(["--write", "--plan"])).toThrow("NJ_PARCEL_INVALID_ARGUMENT");
    expect(() => parseNjParcelReviewArgs(["--snapshot", "https://example.invalid"])).not.toThrow(); // A path only: no network access exists.
  });

  it("independently verifies exact provider bytes and attributes instead of trusting selected snapshot rows", () => {
    const input = captured(snapshot()), raw = JSON.stringify(input), providerRaw = provider(input);
    expect(() => reviewNjParcelSnapshot(raw, [property()], providerRaw + "\n")).toThrow("NJ_PARCEL_PROVIDER_HASH_MISMATCH");
    input.entries[0].attributes.PROP_LOC = "1031 CLINTON ST";
    expect(() => reviewNjParcelSnapshot(JSON.stringify(input), [property()], providerRaw)).toThrow("NJ_PARCEL_PROVIDER_ATTRIBUTES_MISMATCH");
    const incomplete = snapshot(), truncated = JSON.stringify({ objectIdFieldName: "OBJECTID", features: incomplete.entries.map(entry => ({ attributes: entry.attributes })), exceededTransferLimit: true });
    incomplete.provider_response_sha256 = createHash("sha256").update(truncated).digest("hex");
    expect(() => reviewNjParcelSnapshot(JSON.stringify(incomplete), [property()], truncated)).toThrow("NJ_PARCEL_INVALID_PROVIDER_RESPONSE");
  });
});
