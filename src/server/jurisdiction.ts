import type { JurisdictionResolution, PropertyRecord } from "../domain/types";

const CENSUS_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/address";

export class JurisdictionError extends Error {
  constructor(
    public readonly code:
      | "JURISDICTION_INVALID_ADDRESS"
      | "JURISDICTION_NOT_FOUND"
      | "JURISDICTION_NEEDS_REVIEW"
      | "JURISDICTION_UNAVAILABLE",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "JurisdictionError";
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;

function review(message: string): never {
  throw new JurisdictionError("JURISDICTION_NEEDS_REVIEW", message, 422);
}

// Only ordinary street-type and direction abbreviations are normalized. City
// aliases and the starter's candidate city never establish a legal municipality.
const STREET_ABBREVIATIONS: Record<string, string> = {
  STREET: "ST", AVENUE: "AVE", AV: "AVE", ROAD: "RD", BOULEVARD: "BLVD",
  DRIVE: "DR", LANE: "LN", COURT: "CT", PLACE: "PL", SQUARE: "SQ",
  TERRACE: "TER", HIGHWAY: "HWY", PARKWAY: "PKWY", CIRCLE: "CIR",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

function streetTokens(street: string): string[] {
  return street.toUpperCase().replace(/[.,]/g, "").trim().split(/\s+/)
    .map((token) => STREET_ABBREVIATIONS[token] ?? token);
}

function houseNumber(street: string): string | null {
  const token = street.trim().split(/\s+/)[0]?.toUpperCase();
  return token && /^\d+[A-Z]?$/.test(token) ? token.replace(/^0+(?=\d)/, "") : null;
}

function geographyList(geographies: JsonObject, name: string): JsonObject[] {
  const list = geographies[name];
  if (!Array.isArray(list)) return [];
  return list.map(object).filter((item): item is JsonObject => item !== null);
}

/** Resolve an address against a fixed official service, with no caller-selected URL. */
export async function resolveJurisdiction(property: PropertyRecord): Promise<JurisdictionResolution> {
  const street = property.street_address?.trim();
  const cityHint = property.postal_city?.trim();
  const state = property.state?.trim().toUpperCase();
  if (!street || street.length > 300 || !cityHint || cityHint.length > 100 || !state || !/^[A-Z]{2}$/.test(state)) {
    throw new JurisdictionError("JURISDICTION_INVALID_ADDRESS", "The address needs a street, postal city, and state.", 400);
  }
  const requestedNumber = houseNumber(street);
  if (!requestedNumber) review("An address range or unusual street number needs manual boundary review.");
  const url = new URL(CENSUS_ENDPOINT);
  url.search = new URLSearchParams({
    street, city: cityHint, state, benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json",
  }).toString();
  // A missing or corrupted ZIP must not override an otherwise usable address.
  if (/^\d{5}$/.test(property.zip) && !property.quality_flags.includes("zip_state_mismatch")) {
    url.searchParams.set("zip", property.zip);
  }
  let payload: unknown;
  try {
    const response = await fetch(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error();
    payload = JSON.parse(text);
  } catch {
    throw new JurisdictionError("JURISDICTION_UNAVAILABLE", "The Census address service is temporarily unavailable. The municipality remains unresolved.", 503);
  }
  const result = object(object(payload)?.result);
  const matches = result?.addressMatches;
  if (!Array.isArray(matches)) {
    throw new JurisdictionError("JURISDICTION_UNAVAILABLE", "The Census address service returned an unexpected response.", 503);
  }
  if (matches.length === 0) {
    throw new JurisdictionError("JURISDICTION_NOT_FOUND", "Census did not match this address. The municipality remains unresolved.", 422);
  }
  if (matches.length !== 1) review("Census found more than one address match. A boundary review is required.");
  const match = object(matches[0]);
  const matchedAddress = match?.matchedAddress;
  const matchedStreet = typeof matchedAddress === "string" ? matchedAddress.split(",")[0].trim() : "";
  if (houseNumber(matchedStreet) !== requestedNumber) review("The Census match has a different street number. A boundary review is required.");
  const requestedTokens = streetTokens(street).slice(1);
  const matchedTokens = streetTokens(matchedStreet).slice(1);
  if (requestedTokens.join(" ") !== matchedTokens.join(" ")) {
    review("The Census match changed the street name. A boundary review is required.");
  }
  const geographies = object(match?.geographies);
  if (!geographies) review("The address match has no official boundary geography.");
  const states = geographyList(geographies, "States");
  const places = geographyList(geographies, "Incorporated Places");
  if (states.length !== 1 || places.length !== 1) {
    review("Census did not identify a single incorporated municipality. A boundary review is required.");
  }
  const boundaryState = states[0];
  const place = places[0];
  const municipalityId = String(place.GEOID ?? "");
  const stateCode = String(boundaryState.STATE ?? boundaryState.GEOID ?? "");
  const legalCity = typeof place.BASENAME === "string" ? place.BASENAME.trim() : "";
  if (
    boundaryState.STUSAB !== state || !/^\d{2}$/.test(stateCode) ||
    String(place.STATE ?? "") !== stateCode || !/^\d{7}$/.test(municipalityId) ||
    !municipalityId.startsWith(stateCode) || !legalCity || place.FUNCSTAT !== "A"
  ) {
    review("The returned state or municipality boundary is inconsistent with this address.");
  }
  return {
    state, legal_city: legalCity, verified: true, method: "census_geographies",
    resolved_at: new Date().toISOString(), source_url: url.toString(), municipality_id: municipalityId,
    note: "Census Current_Current incorporated-place boundary for the matched address. This verifies the current municipality; historical boundaries may need separate review.",
  };
}
