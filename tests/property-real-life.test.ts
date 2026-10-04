import { describe, expect, it } from "vitest";
import challenge from "../src/data/challenge.json";
import type { PropertyRecord } from "../src/domain/types";
import type { MapLocation } from "../src/lib/property-map-location";
import { getGoogleAddressUrl, getStreetViewUrl } from "../src/lib/property-real-life";

const property = (overrides: Partial<PropertyRecord> = {}): PropertyRecord => ({
  ...(challenge.properties[0] as PropertyRecord), ...overrides,
});
const location = (overrides: Partial<MapLocation> = {}): MapLocation => ({
  lat: 34.096, lon: -118.325, precision: "address", source: "photon", zoom: 17, ...overrides,
});

describe("real-life Street View links", () => {
  it.each(["address", "street"] as const)("uses the official no-key panorama URL for a valid %s location", precision => {
    const result = getStreetViewUrl(location({ precision }));
    expect(result).not.toBeNull();
    const url = new URL(result!);
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/@");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("map_action")).toBe("pano");
    expect(url.searchParams.get("viewpoint")).toBe("34.096,-118.325");
    expect(url.searchParams.has("key")).toBe(false);
    expect(url.searchParams.has("pano")).toBe(false);
  });

  it("never opens a panorama at an area center as if it were the requested property", () => {
    expect(getStreetViewUrl(location({ precision: "area", source: "area", zoom: 11 }))).toBeNull();
  });

  it.each([
    { lat: Number.NaN, lon: -118.325 },
    { lat: 34.096, lon: Infinity },
    { lat: 90.1, lon: -118.325 },
    { lat: 34.096, lon: -180.1 },
  ])("rejects invalid panorama coordinates: %j", point => {
    expect(getStreetViewUrl(location(point))).toBeNull();
  });

  it("rejects missing locations and numeric strings instead of coercing them", () => {
    type StreetViewInput = Parameters<typeof getStreetViewUrl>[0];
    for (const point of [
      null, undefined,
      { ...location(), lat: "34.096" },
      { ...location(), lon: "-118.325" },
    ]) {
      expect(getStreetViewUrl(point as StreetViewInput)).toBeNull();
    }
  });
});

describe("Google address searches", () => {
  it("keeps the supplied street, postal city and state in the encoded search query", () => {
    const url = new URL(getGoogleAddressUrl(property()));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    const query = url.searchParams.get("query")!;
    expect(query).toContain("6238 DE LONGPRE AVE");
    expect(query).toContain("Los Angeles");
    expect(query).toContain("CA");
    expect(url.searchParams.has("key")).toBe(false);
  });

  it("excludes a dataset ZIP that contradicts the supplied state", () => {
    const supplied = property({
      street_address: "876-878 S 14TH ST", postal_city: "Newark", state: "NJ", zip: "11219",
      quality_flags: ["zip_state_mismatch", "street_number_range"],
    });
    const query = new URL(getGoogleAddressUrl(supplied)).searchParams.get("query")!;
    expect(query).toContain("876-878 S 14TH ST");
    expect(query).toContain("Newark");
    expect(query).toContain("NJ");
    expect(query).not.toContain("11219");
    expect(supplied.zip).toBe("11219");
  });

  it("encodes punctuation and reserved characters without creating additional URL parameters", () => {
    const street = "10 O'NEIL ST & UNIT #2";
    const url = new URL(getGoogleAddressUrl(property({ street_address: street })));
    expect(url.searchParams.get("query")).toContain(street);
    expect(url.hash).toBe("");
    expect(url.searchParams.getAll("api")).toEqual(["1"]);
    expect(url.searchParams.getAll("query")).toHaveLength(1);
    expect([...url.searchParams.keys()].sort()).toEqual(["api", "query"]);
  });

  it("retains the supplied postal neighborhood instead of claiming a verified legal city", () => {
    const supplied = property({ postal_city: "Allston", state: "MA", legal_city_candidate: "Boston", zip: "02134" });
    const query = new URL(getGoogleAddressUrl(supplied)).searchParams.get("query")!;
    expect(query).toContain("Allston");
    expect(query).toContain("MA");
    expect(query).not.toContain("Boston");
    expect(supplied.jurisdiction_status).toBe("unresolved");
  });
});
