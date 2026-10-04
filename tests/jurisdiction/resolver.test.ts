import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveJurisdiction } from "../../src/server/jurisdiction";
import type { PropertyRecord } from "../../src/domain/types";

const property: PropertyRecord = {
  address_id: "A-test", street_address: "36 Westland Avenue", postal_city: "Boston", state: "MA", zip: "02115",
  year_built: null, units: null, use_code: "", use_description: "", source_dataset: "test", retrieved_at: "2026-10-01T00:00:00Z",
  legal_city_candidate: "An alias is not evidence", jurisdiction_status: "unresolved", missing_facts: [], quality_flags: [],
};

function match(overrides: Record<string, unknown> = {}) {
  return {
    matchedAddress: "36 WESTLAND AVE, BOSTON, MA, 02115",
    geographies: {
      States: [{ STUSAB: "MA", STATE: "25", GEOID: "25" }],
      "Incorporated Places": [{ BASENAME: "Boston", NAME: "Boston city", STATE: "25", GEOID: "2507000", FUNCSTAT: "A" }],
    },
    ...overrides,
  };
}
const fetchMock = vi.fn();
function answer(matches: unknown[]) {
  fetchMock.mockResolvedValue(Response.json({ result: { addressMatches: matches } }));
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("official municipality resolution", () => {
  it("uses the unique incorporated boundary, ignoring postal city aliases", async () => {
    answer([match()]);
    const resolution = await resolveJurisdiction(property);
    expect(resolution).toMatchObject({ state: "MA", legal_city: "Boston", verified: true, municipality_id: "2507000", method: "census_geographies" });
    const requested = new URL(fetchMock.mock.calls[0][0]);
    expect(requested.origin).toBe("https://geocoding.geo.census.gov");
    expect(requested.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(requested.searchParams.get("vintage")).toBe("Current_Current");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });

  it("rejects no-match and multiple-match responses", async () => {
    answer([]);
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_NOT_FOUND", status: 422 });
    answer([match(), match()]);
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_NEEDS_REVIEW", status: 422 });
  });

  it("rejects a different house number or a changed street", async () => {
    answer([match({ matchedAddress: "38 WESTLAND AVE, BOSTON, MA, 02115" })]);
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_NEEDS_REVIEW" });
    answer([match({ matchedAddress: "36 WESTLAND ST, BOSTON, MA, 02115" })]);
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_NEEDS_REVIEW" });
  });

  it("requires an incorporated municipality and a consistent state", async () => {
    answer([match({ geographies: { States: [{ STUSAB: "MA", STATE: "25" }], "Census Designated Places": [{ BASENAME: "Boston" }] } })]);
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_NEEDS_REVIEW" });
    const wrongState = match();
    wrongState.geographies.States[0].STUSAB = "NJ";
    answer([wrongState]);
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_NEEDS_REVIEW" });
  });

  it("keeps street ranges unresolved and omits a known corrupted ZIP", async () => {
    await expect(resolveJurisdiction({ ...property, street_address: "36-38 Westland Ave" }))
      .rejects.toMatchObject({ code: "JURISDICTION_NEEDS_REVIEW" });
    expect(fetchMock).not.toHaveBeenCalled();
    answer([match()]);
    await resolveJurisdiction({ ...property, zip: "90210", quality_flags: ["zip_state_mismatch"] });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("zip")).toBe(false);
  });

  it("cannot turn address text into a caller-selected network target", async () => {
    answer([]);
    await expect(resolveJurisdiction({ ...property, postal_city: "http://127.0.0.1/private?city=x" }))
      .rejects.toMatchObject({ code: "JURISDICTION_NOT_FOUND" });
    expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe("https://geocoding.geo.census.gov");
  });

  it("fails with a controlled unavailable result when the official service fails", async () => {
    fetchMock.mockRejectedValue(new Error("network detail"));
    await expect(resolveJurisdiction(property)).rejects.toMatchObject({ code: "JURISDICTION_UNAVAILABLE", status: 503 });
  });
});
