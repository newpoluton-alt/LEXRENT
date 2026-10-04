import { describe, expect, it } from "vitest";
import challenge from "../src/data/challenge.json";
import type { PropertyRecord } from "../src/domain/types";
import { getAreaMapLocation, isValidMapPoint, selectPhotonLocation } from "../src/lib/property-map-location";

const properties = challenge.properties as PropertyRecord[];
const property = (overrides: Partial<PropertyRecord> = {}): PropertyRecord => ({ ...properties[0], ...overrides });
const photon = (fields: Record<string, unknown> = {}, coordinates: unknown = [-118.325, 34.096]) => ({
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: { countrycode: "US", state: "California", city: "Los Angeles", street: "De Longpre Avenue", housenumber: "6238", ...fields },
  }],
});

describe("map area fallback", () => {
  it("gives every supplied property an area center in its expected state", () => {
    // Geographic envelopes validate orientation only, not legal boundaries.
    const bounds: Record<string, { lat: [number, number]; lon: [number, number] }> = {
      CA: { lat: [32, 42.1], lon: [-125, -114] },
      NJ: { lat: [38.8, 41.6], lon: [-75.7, -73.8] },
      MA: { lat: [41.2, 42.9], lon: [-73.6, -69.8] },
    };
    expect(properties).toHaveLength(500);
    for (const supplied of properties) {
      const center = getAreaMapLocation(supplied);
      const envelope = bounds[supplied.state];
      expect(envelope, supplied.address_id).toBeDefined();
      expect(center.precision, supplied.address_id).toBe("area");
      expect(center.source, supplied.address_id).toBe("area");
      expect(isValidMapPoint(center), supplied.address_id).toBe(true);
      expect(center.lat, supplied.address_id).toBeGreaterThanOrEqual(envelope.lat[0]);
      expect(center.lat, supplied.address_id).toBeLessThanOrEqual(envelope.lat[1]);
      expect(center.lon, supplied.address_id).toBeGreaterThanOrEqual(envelope.lon[0]);
      expect(center.lon, supplied.address_id).toBeLessThanOrEqual(envelope.lon[1]);
      expect(center.zoom, supplied.address_id).toBeLessThan(16);
    }
  });

  it("keeps unknown places usable with finite state and country area fallbacks", () => {
    for (const candidate of [
      { state: "NJ", postal_city: "Unlisted postal place" },
      { state: "", postal_city: "" },
      { state: "UNKNOWN", postal_city: "Unknown" },
    ]) {
      const center = getAreaMapLocation(candidate);
      expect(isValidMapPoint(center)).toBe(true);
      expect(center).toMatchObject({ precision: "area", source: "area" });
      expect(Number.isFinite(center.zoom)).toBe(true);
    }
    const newJersey = getAreaMapLocation({ state: "NJ", postal_city: "Unlisted postal place" });
    expect(newJersey.lat).toBeGreaterThan(38.8);
    expect(newJersey.lat).toBeLessThan(41.6);
    expect(newJersey.lon).toBeGreaterThan(-75.7);
    expect(newJersey.lon).toBeLessThan(-73.8);
  });
});

describe("Photon address and street selection", () => {
  it("recognizes an exact address with normalized case, punctuation and street abbreviations", () => {
    const supplied = property({ street_address: "6238 W. DE LONGPRE AVE" });
    const result = selectPhotonLocation(photon({ street: "West De Longpre Avenue", countrycode: "us" }), supplied);
    expect(result).toMatchObject({ lat: 34.096, lon: -118.325, precision: "address", source: "photon" });
    expect(result!.zoom).toBeGreaterThanOrEqual(16);
  });

  it.each([
    ["another house", { housenumber: "6240" }],
    ["another street", { street: "West Manchester Avenue" }],
    ["another city", { city: "San Diego" }],
    ["another state", { state: "New Jersey" }],
    ["another country", { countrycode: "CA" }],
    ["missing country", { countrycode: undefined }],
  ])("rejects %s instead of placing a misleading property pin", (_case, fields) => {
    expect(selectPhotonLocation(photon(fields), property())).toBeNull();
  });

  it.each(["1031", "1035"])("does not convert house-number range 1031-1035 into a pin at %s", number => {
    const supplied = property({ street_address: "1031-1035 CLINTON ST", postal_city: "Hoboken", state: "NJ", zip: "07030" });
    const result = selectPhotonLocation(photon({ state: "New Jersey", city: "Hoboken", street: "Clinton Street", housenumber: number }, [-74.028, 40.750]), supplied);
    expect(result).toBeNull();
  });

  it("accepts a matching street without a house number at street precision", () => {
    const result = selectPhotonLocation(photon({ housenumber: undefined, type: "street" }), property());
    expect(result).toMatchObject({ precision: "street", source: "photon", lat: 34.096, lon: -118.325 });
    expect(result!.zoom).toBeLessThan(17);
  });

  it("uses a street feature's name when Photon identifies it as a highway", () => {
    const result = selectPhotonLocation(photon({ housenumber: undefined, street: undefined, name: "De Longpre Avenue", osm_key: "highway" }), property());
    expect(result).toMatchObject({ precision: "street", source: "photon" });
  });

  it("does not treat a named business as a matching street", () => {
    expect(selectPhotonLocation(photon({ housenumber: undefined, street: undefined, name: "De Longpre Avenue", osm_key: "shop" }), property())).toBeNull();
  });

  it("prefers a matching address over a matching street appearing first", () => {
    const street = photon({ housenumber: undefined, type: "street" }).features[0];
    const address = photon().features[0];
    expect(selectPhotonLocation({ features: [street, address] }, property())?.precision).toBe("address");
  });

  it.each(["Allston", "Brighton", "Dorchester", "South Boston"])("accepts Boston as a visual postal alias for %s without resolving its legal municipality", postalCity => {
    const supplied = property({ street_address: "10 Test Ave", postal_city: postalCity, state: "MA", legal_city_candidate: "Boston" });
    const result = selectPhotonLocation(photon({ city: "Boston", state: "Massachusetts", street: "Test Avenue", housenumber: "10" }, [-71.07, 42.34]), supplied);
    expect(result).toMatchObject({ precision: "address", source: "photon", lat: 42.34, lon: -71.07 });
    expect(supplied.jurisdiction_status).toBe("unresolved");
  });

  it.each([
    ["numeric strings", ["-118.325", "34.096"]],
    ["latitude outside the world", [-118.325, 91]],
    ["longitude outside the world", [-181, 34.096]],
    ["nonfinite coordinate", [Number.NaN, 34.096]],
    ["missing coordinate", [-118.325]],
    ["non-array coordinate", null],
  ])("rejects malformed Photon geometry: %s", (_case, coordinates) => {
    expect(selectPhotonLocation(photon({}, coordinates), property())).toBeNull();
  });

  it("handles unusable provider responses without throwing", () => {
    for (const response of [null, undefined, "bad response", {}, { features: {} }, { features: [null, 123, {}] }]) {
      expect(selectPhotonLocation(response, property())).toBeNull();
    }
    const wrongGeometry = photon();
    wrongGeometry.features[0].geometry.type = "LineString";
    expect(selectPhotonLocation(wrongGeometry, property())).toBeNull();
  });
});

describe("map point validation", () => {
  it("accepts real finite coordinates including equator and prime meridian", () => {
    for (const point of [{ lat: 34.096, lon: -118.325 }, { lat: 0, lon: 0 }, { lat: -90, lon: 180 }]) {
      expect(isValidMapPoint(point)).toBe(true);
    }
  });

  it("rejects strings, missing coordinates, infinities and out-of-range coordinates", () => {
    for (const point of [
      null, undefined, {}, { lat: 0 }, { lat: "34", lon: -118 },
      { lat: 34, lon: "-118" }, { lat: Number.NaN, lon: 0 }, { lat: 0, lon: Infinity },
      { lat: 90.01, lon: 0 }, { lat: 0, lon: -180.01 },
    ]) {
      expect(isValidMapPoint(point as Parameters<typeof isValidMapPoint>[0])).toBe(false);
    }
  });
});
