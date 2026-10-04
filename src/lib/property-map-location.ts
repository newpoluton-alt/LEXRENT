import type { PropertyRecord } from "../domain/types";

export type MapPoint = { lat: number; lon: number };
export type MapLocation = MapPoint & {
  precision: "address" | "street" | "area";
  source: "photon" | "area" | "provided";
  zoom: number;
};

// Rounded postal-place centers for orientation, never property coordinates or boundaries.
// A local starting view keeps the map usable even when the address geocoder is unavailable.
const AREA_CENTERS: Record<string, [number, number, number]> = {
  "CA:los angeles": [34.052, -118.244, 11],
  "CA:berkeley": [37.871, -122.273, 13],
  "CA:san francisco": [37.775, -122.419, 12],
  "CA:san diego": [32.716, -117.161, 11],
  "CA:san ysidro": [32.553, -117.043, 13],
  "NJ:hoboken": [40.744, -74.032, 14],
  "NJ:newark": [40.736, -74.172, 12],
  "NJ:jersey city": [40.728, -74.078, 12],
  "MA:boston": [42.360, -71.059, 12],
  "MA:cambridge": [42.374, -71.110, 13],
  "MA:south boston": [42.337, -71.047, 13],
  "MA:brighton": [42.350, -71.156, 13],
  "MA:allston": [42.354, -71.132, 13],
  "MA:roxbury": [42.315, -71.091, 13],
  "MA:dorchester": [42.300, -71.060, 12],
  "MA:jamaica plain": [42.310, -71.115, 13],
  "MA:east boston": [42.376, -71.039, 13],
  "MA:hyde park": [42.256, -71.124, 13],
  "MA:mattapan": [42.277, -71.092, 13],
};
const STATE_CENTERS: Record<string, [number, number, number]> = {
  CA: [37.0, -119.5, 6], NJ: [40.0, -74.5, 8], MA: [42.2, -71.8, 7],
};
const STATE_NAMES: Record<string, string> = { california: "CA", massachusetts: "MA", "new jersey": "NJ" };
const BOSTON_POSTAL_PLACES = new Set([
  "south boston", "brighton", "allston", "roxbury", "dorchester", "jamaica plain", "east boston", "hyde park", "mattapan",
]);
const STREET_WORDS: Record<string, string> = {
  st: "street", ave: "avenue", av: "avenue", rd: "road", blvd: "boulevard", dr: "drive",
  ln: "lane", ct: "court", pl: "place", pkwy: "parkway", ter: "terrace", hwy: "highway",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function normalized(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}
function streetName(value: unknown): string {
  return normalized(value).split(/\s+/).map(word => STREET_WORDS[word] ?? word).join(" ");
}
export function isValidMapPoint(point: MapPoint | null | undefined): point is MapPoint {
  return !!point && typeof point.lat === "number" && typeof point.lon === "number" &&
    Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

export function getAreaMapLocation(property: Pick<PropertyRecord, "state" | "postal_city">): MapLocation {
  const [lat, lon, zoom] = AREA_CENTERS[`${property.state}:${normalized(property.postal_city)}`] ??
    STATE_CENTERS[property.state] ?? [39.5, -98.35, 4];
  return { lat, lon, zoom, precision: "area", source: "area" };
}

/** Display matching only. No result from this function verifies legal jurisdiction. */
export function selectPhotonLocation(data: unknown, property: PropertyRecord): MapLocation | null {
  const features = record(data)?.features;
  const address = /^(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[a-z]?)\s+(.+)$/i.exec(property.street_address.trim());
  if (!Array.isArray(features) || !address) return null;
  const wantedStreet = streetName(address[2].replace(/\s+(?:apt|unit|suite|#)\s*\S+.*$/i, ""));
  const wantedCity = normalized(property.postal_city);
  const streets: { location: MapLocation; postcodeMatches: boolean }[] = [];
  for (const feature of features.slice(0, 10)) {
    const item = record(feature), fields = record(item?.properties), geometry = record(item?.geometry);
    const coordinates = geometry?.coordinates;
    if (!fields || geometry?.type !== "Point" || !Array.isArray(coordinates)) continue;
    const point = { lat: coordinates[1], lon: coordinates[0] } as MapPoint;
    if (!isValidMapPoint(point)) continue;
    const state = STATE_NAMES[normalized(fields.state)] ?? String(fields.state ?? "").toUpperCase();
    const places = [fields.city, fields.locality, fields.district].map(normalized);
    const postalPlaceMatches = places.includes(wantedCity) ||
      (property.state === "MA" && BOSTON_POSTAL_PLACES.has(wantedCity) && places.includes("boston")) ||
      (property.state === "CA" && wantedCity === "san ysidro" && places.includes("san diego"));
    if (String(fields.countrycode).toUpperCase() !== "US" || state !== property.state || !postalPlaceMatches) continue;
    const houseNumber = normalized(fields.housenumber);
    const candidateStreet = streetName(fields.street ?? (!houseNumber && fields.osm_key === "highway" ? fields.name : ""));
    if (candidateStreet !== wantedStreet) continue;
    if (houseNumber === normalized(address[1])) {
      return { ...point, precision: "address", source: "photon", zoom: 17 };
    }
    // A wrong house is never used as a stand-in for the requested house or street.
    if (!houseNumber && (fields.type === "street" || fields.osm_key === "highway")) {
      streets.push({ location: { ...point, precision: "street", source: "photon", zoom: 15 },
        postcodeMatches: !!property.zip && normalized(fields.postcode) === normalized(property.zip) });
    }
  }
  return streets.find(item => item.postcodeMatches)?.location ?? streets[0]?.location ?? null;
}
