import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JurisdictionResolution, PropertyRecord } from "../../src/domain/types";
import { JurisdictionError } from "../../src/server/jurisdiction";
import { enrichOneJurisdiction, parseJurisdictionArgs, runJurisdictionEnrichment, validResolution, type JurisdictionOptions } from "../../scripts/enrich-jurisdictions";

function property(id = "TEST", state = "MA"): PropertyRecord {
  return { address_id: id, street_address: "1 Test Street", postal_city: "Postal Candidate", state, zip: "02110", year_built: null, units: null, use_code: "", use_description: "", source_dataset: "synthetic test", retrieved_at: "2026-10-01T00:00:00Z", legal_city_candidate: "Unverified Candidate", jurisdiction_status: "unresolved", missing_facts: ["legal_municipality"], quality_flags: [] };
}
function resolution(p: PropertyRecord): JurisdictionResolution {
  const fips: Record<string, string> = { MA: "25", NJ: "34", CA: "06" };
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/address");
  url.search = new URLSearchParams({ street: p.street_address, city: p.postal_city, state: p.state, benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json", ...(p.zip ? { zip: p.zip } : {}) }).toString();
  return { state: p.state, legal_city: "Verified Test City", verified: true, method: "census_geographies", resolved_at: "2026-10-04T00:00:00Z", source_url: url.toString(), municipality_id: fips[p.state] + "00001" };
}
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function options(): Promise<JurisdictionOptions> {
  const outputDir = await mkdtemp(join(tmpdir(), "lexrent-jurisdiction-test-")); dirs.push(outputDir);
  return { outputDir, states: ["CA", "NJ", "MA"], limit: 500, retryFailed: false };
}

describe("resumable official municipal enrichment", () => {
  it("rejects ranges before a network request and never replaces them with an endpoint", async () => {
    const resolver = vi.fn();
    const p = { ...property(), street_address: "1-3 Test Street" };
    expect(await enrichOneJurisdiction(p, resolver)).toMatchObject({ status: "needs_review", attempts: [], original_address: { street_address: "1-3 Test Street" } });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("retries a no-match without ZIP while preserving original fields and query evidence", async () => {
    const p = property(), original = structuredClone(p);
    const resolver = vi.fn(async (query: PropertyRecord) => {
      if (query.zip) throw new JurisdictionError("JURISDICTION_NOT_FOUND", "No official match.", 422);
      return resolution(query);
    });
    const entry = await enrichOneJurisdiction(p, resolver);
    expect(entry).toMatchObject({ status: "verified", original_address: { zip: "02110" }, attempts: [{ zip_used: "02110", outcome: "JURISDICTION_NOT_FOUND" }, { zip_used: "", outcome: "verified" }] });
    expect(entry.resolution?.legal_city).toBe("Verified Test City");
    expect(entry.resolution?.source_url).not.toContain("zip=");
    expect(p).toEqual(original);
  });

  it("omits flagged ZIPs initially and does not retry transient provider errors", async () => {
    const p = { ...property("NJ", "NJ"), zip: "11219", quality_flags: ["zip_state_mismatch"] };
    const resolver = vi.fn(async (_query: PropertyRecord) => { throw new Error("private network diagnostics"); });
    const entry = await enrichOneJurisdiction(p, resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0][0].zip).toBe("");
    expect(entry).toMatchObject({ status: "unavailable", error_code: "JURISDICTION_UNAVAILABLE", original_address: { zip: "11219" } });
    expect(JSON.stringify(entry)).not.toContain("private network diagnostics");
  });

  it("rejects inconsistent source/street/state/municipality metadata", () => {
    const p = property(), good = resolution(p);
    expect(validResolution(good, p)).toBe(true);
    expect(validResolution({ ...good, state: "NJ" }, p)).toBe(false);
    expect(validResolution({ ...good, municipality_id: "3400001" }, p)).toBe(false);
    expect(validResolution({ ...good, source_url: "https://example.invalid/census" }, p)).toBe(false);
    const url = new URL(good.source_url); url.searchParams.set("street", "2 Different Street");
    expect(validResolution({ ...good, source_url: url.toString() }, p)).toBe(false);
    expect(validResolution({ ...good, verified: false }, p)).toBe(false);
  });

  it("caps concurrency at eight, checkpoints and reuses only matching original input", async () => {
    const config = await options();
    const properties = Array.from({ length: 12 }, (_, index) => ({ ...property(`P${index}`), street_address: `${index + 1} Test Street` }));
    let active = 0, maximum = 0;
    const resolver = vi.fn(async (p: PropertyRecord) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return resolution(p);
    });
    const first = await runJurisdictionEnrichment(properties, config, { resolver });
    expect(first).toMatchObject({ total_properties: 12, verified_count: 12, unresolved_count: 0, processed_this_run: 12 });
    expect(maximum).toBe(8);
    const saved = JSON.parse(await readFile(join(config.outputDir, "jurisdiction-resolutions.json"), "utf8"));
    expect(Object.keys(saved)).toHaveLength(12);
    const none = vi.fn();
    expect(await runJurisdictionEnrichment(properties, config, { resolver: none })).toMatchObject({ reused_this_run: 12, processed_this_run: 0 });
    expect(none).not.toHaveBeenCalled();
    const changed = properties.map((p, index) => index ? p : { ...p, street_address: "100 Changed Street" });
    const update = vi.fn(async (p: PropertyRecord) => resolution(p));
    expect(await runJurisdictionEnrichment(changed, config, { resolver: update })).toMatchObject({ reused_this_run: 11, processed_this_run: 1 });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("retains unresolved evidence and supports an explicit retry without forcing counts", async () => {
    const config = await options(), p = property();
    const fail = vi.fn(async () => { throw new JurisdictionError("JURISDICTION_UNAVAILABLE", "Unavailable.", 503); });
    expect(await runJurisdictionEnrichment([p], config, { resolver: fail })).toMatchObject({ verified_count: 0, unresolved_count: 1 });
    const retry = vi.fn(async (p: PropertyRecord) => resolution(p));
    await runJurisdictionEnrichment([p], config, { resolver: retry });
    expect(retry).not.toHaveBeenCalled();
    expect(await runJurisdictionEnrichment([p], { ...config, retryFailed: true }, { resolver: retry })).toMatchObject({ verified_count: 1, unresolved_count: 0 });
    expect(parseJurisdictionArgs(["--states", "NJ", "--limit", "5"])).toMatchObject({ states: ["NJ"], limit: 5 });
    expect(() => parseJurisdictionArgs(["--states", "NY"])).toThrow();
  });
});
