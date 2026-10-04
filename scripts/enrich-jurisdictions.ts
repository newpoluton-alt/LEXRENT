import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import type { JurisdictionResolution, PropertyRecord } from "../src/domain/types";
import { JurisdictionError, resolveJurisdiction } from "../src/server/jurisdiction";
import { validNjParcelResolution } from "./review-nj-parcels";

const VERSION = "census-strict-address-v1";
const CONCURRENCY = 8;
const STATE_FIPS: Record<string, string> = { CA: "06", NJ: "34", MA: "25" };
type FailureStatus = "needs_review" | "not_found" | "unavailable" | "invalid_address";
export interface JurisdictionAuditEntry {
  address_id: string; input_hash: string; checked_at: string; status: "verified" | FailureStatus;
  original_address: { street_address: string; postal_city: string; state: string; zip: string };
  attempts: { city_hint: string; zip_used: string; outcome: string }[];
  error_code?: string; note?: string; resolution?: JurisdictionResolution;
}
export interface JurisdictionAudit {
  parser_version: string; generated_at: string; source_documentation: string;
  method_note: string; total_properties: number; verified_count: number; unresolved_count: number;
  by_state: Record<string, { total: number; verified: number; unresolved: number }>;
  by_legal_city: Record<string, number>; entries: Record<string, JurisdictionAuditEntry>;
}
export interface JurisdictionOptions { outputDir: string; states: string[]; limit: number; retryFailed: boolean }
const HELP = `Enrich public challenge addresses using official Census boundary geography.
Usage: node --import tsx scripts/enrich-jurisdictions.ts [--states CA,NJ,MA] [--limit 500] [--retry-failed]
--output-dir   Default corpus; writes jurisdiction-resolutions.json and jurisdiction-audit.json.
--states       Optional subset of CA,NJ,MA.
--limit        Maximum properties selected this run, default 500.
--retry-failed Retry previously unresolved entries; verified matching entries are reused.
Single official geographies requests use strict street-number/name and state/place
checks, concurrency 8 and the resolver's 15-second timeout. Corrupted ZIP hints may
be omitted; no-match/review failures may retry without ZIP. Ranges are never forced.
This writes local evidence only and does not publish to the database.`;

export function parseJurisdictionArgs(args: readonly string[], cwd = process.cwd()): JurisdictionOptions | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  const config: JurisdictionOptions = { outputDir: resolve(cwd, "corpus"), states: ["CA", "NJ", "MA"], limit: 500, retryFailed: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error("INVALID_ARGUMENT"); seen.add(flag);
    if (flag === "--retry-failed") { config.retryFailed = true; continue; }
    if (!["--states", "--limit", "--output-dir"].includes(flag)) throw new Error("INVALID_ARGUMENT");
    const value = args[++i]; if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENT");
    if (flag === "--states") {
      config.states = [...new Set(value.split(",").map(value => value.trim()))];
      if (!config.states.length || config.states.some(state => !STATE_FIPS[state])) throw new Error("INVALID_STATE");
    } else if (flag === "--limit") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 500) throw new Error("INVALID_LIMIT");
      config.limit = Number(value);
    } else config.outputDir = resolve(cwd, value);
  }
  return config;
}
export function jurisdictionInputHash(property: PropertyRecord) {
  return createHash("sha256").update(JSON.stringify([VERSION, property.address_id, property.street_address, property.postal_city, property.state, property.zip, property.quality_flags])).digest("hex");
}
export function validResolution(resolution: unknown, property: PropertyRecord): resolution is JurisdictionResolution {
  if (!resolution || typeof resolution !== "object") return false;
  const value = resolution as JurisdictionResolution;
  if (value.method === "manual_review") return validNjParcelResolution(value, property);
  try {
    const url = new URL(value.source_url);
    return value.verified === true && value.method === "census_geographies" && value.state === property.state && Boolean(value.legal_city?.trim()) && /^\d{7}$/.test(value.municipality_id ?? "") && Boolean(value.municipality_id?.startsWith(STATE_FIPS[property.state])) && Number.isFinite(Date.parse(value.resolved_at)) && url.protocol === "https:" && url.hostname === "geocoding.geo.census.gov" && url.pathname === "/geocoder/geographies/address" && url.searchParams.get("street") === property.street_address.trim() && url.searchParams.get("state") === property.state;
  } catch { return false; }
}
const failureStatus = (code: string): FailureStatus => code === "JURISDICTION_NOT_FOUND" ? "not_found" : code === "JURISDICTION_INVALID_ADDRESS" ? "invalid_address" : code === "JURISDICTION_NEEDS_REVIEW" ? "needs_review" : "unavailable";

/** Original sample values are never mutated; ZIP removal is a recorded query hint. */
export async function enrichOneJurisdiction(property: PropertyRecord, resolver = resolveJurisdiction): Promise<JurisdictionAuditEntry> {
  const entry: JurisdictionAuditEntry = { address_id: property.address_id, input_hash: jurisdictionInputHash(property), checked_at: new Date().toISOString(), status: "unavailable", original_address: { street_address: property.street_address, postal_city: property.postal_city, state: property.state, zip: property.zip }, attempts: [] };
  if (!/^\d+[A-Za-z]?(?:\s|$)/.test(property.street_address.trim())) {
    return { ...entry, status: "needs_review", error_code: "JURISDICTION_NEEDS_REVIEW", note: "A range or unusual street number needs separate public parcel/boundary review; no endpoint was selected." };
  }
  const withZip = /^\d{5}$/.test(property.zip) && !property.quality_flags.includes("zip_state_mismatch");
  const candidates = [withZip ? property : { ...property, zip: "" }];
  if (withZip) candidates.push({ ...property, zip: "" });
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    try {
      const resolution = await resolver(candidate);
      if (!validResolution(resolution, property)) throw new JurisdictionError("JURISDICTION_NEEDS_REVIEW", "The boundary resolution has inconsistent source or state metadata.", 422);
      entry.attempts.push({ city_hint: candidate.postal_city, zip_used: candidate.zip, outcome: "verified" });
      return { ...entry, status: "verified", resolution, note: "Verified current incorporated municipality for an unchanged street number/name. Current boundaries do not independently prove historical jurisdiction." };
    } catch (error) {
      const code = error instanceof JurisdictionError ? error.code : "JURISDICTION_UNAVAILABLE";
      entry.attempts.push({ city_hint: candidate.postal_city, zip_used: candidate.zip, outcome: code });
      entry.status = failureStatus(code); entry.error_code = code;
      entry.note = error instanceof JurisdictionError ? error.message : "The official Census request was unavailable; no municipality was inferred.";
      // A corrupted ZIP may cause a no match or changed street. Retry the same
      // exact street/city/state without it, but do not multiply transient traffic.
      if (!["JURISDICTION_NOT_FOUND", "JURISDICTION_NEEDS_REVIEW"].includes(code)) break;
    }
  }
  return entry;
}
function summarize(properties: readonly PropertyRecord[], entries: Record<string, JurisdictionAuditEntry>): JurisdictionAudit {
  const verified = properties.filter(property => entries[property.address_id]?.status === "verified" && validResolution(entries[property.address_id]?.resolution, property));
  const by_state = Object.fromEntries(Object.keys(STATE_FIPS).map(state => {
    const total = properties.filter(property => property.state === state).length, count = verified.filter(property => property.state === state).length;
    return [state, { total, verified: count, unresolved: total - count }];
  }));
  const by_legal_city: Record<string, number> = {};
  for (const property of verified) { const label = entries[property.address_id].resolution!.legal_city + ", " + property.state; by_legal_city[label] = (by_legal_city[label] ?? 0) + 1; }
  return { parser_version: VERSION, generated_at: new Date().toISOString(), source_documentation: "https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html", method_note: "The Census address and coordinate batch services return state/county/tract/block codes, not incorporated-place geography. This run uses single geographies/address requests with strict matched street and state/place verification. Postal city is a query hint, never legal-boundary proof. Original property facts are retained.", total_properties: properties.length, verified_count: verified.length, unresolved_count: properties.length - verified.length, by_state, by_legal_city, entries };
}
async function writeJsonAtomic(file: string, data: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n"); await rename(temp, file);
}
async function existingAudit(file: string): Promise<JurisdictionAudit | null> {
  try {
    const audit = JSON.parse(await readFile(file, "utf8")) as JurisdictionAudit;
    return audit.parser_version === VERSION && audit.entries && typeof audit.entries === "object" ? audit : null;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
}

export async function runJurisdictionEnrichment(properties: readonly PropertyRecord[], options: JurisdictionOptions, dependencies: { resolver?: typeof resolveJurisdiction; report?: (summary: { processed: number; verified: number; unresolved: number; reused: number }) => void } = {}) {
  await mkdir(options.outputDir, { recursive: true });
  const auditPath = join(options.outputDir, "jurisdiction-audit.json"), resolutionsPath = join(options.outputDir, "jurisdiction-resolutions.json");
  const previous = await existingAudit(auditPath), entries: Record<string, JurisdictionAuditEntry> = {};
  const selected = properties.filter(property => options.states.includes(property.state)).slice(0, options.limit);
  let reused = 0, processed = 0, cursor = 0;
  // Carry forward only matching reviewed/cached input, including unselected states.
  for (const property of properties) {
    const cached = previous?.entries[property.address_id];
    if (cached?.input_hash === jurisdictionInputHash(property) && (cached.status !== "verified" || validResolution(cached.resolution, property))) entries[property.address_id] = cached;
  }
  const queued = selected.filter(property => {
    const cached = entries[property.address_id];
    if (cached && (cached.status === "verified" || !options.retryFailed)) { reused++; return false; }
    return true;
  });
  let writes = Promise.resolve();
  function checkpoint() {
    const audit = structuredClone(summarize(properties, entries));
    const resolutions = Object.fromEntries(properties.flatMap(property => {
      const entry = audit.entries[property.address_id];
      return entry?.status === "verified" && validResolution(entry.resolution, property) ? [[property.address_id, entry.resolution]] : [];
    }));
    writes = writes.then(() => Promise.all([writeJsonAtomic(auditPath, audit), writeJsonAtomic(resolutionsPath, resolutions)])).then(() => undefined);
    return writes;
  }
  async function worker() {
    while (cursor < queued.length) {
      const property = queued[cursor++];
      entries[property.address_id] = await enrichOneJurisdiction(property, dependencies.resolver);
      processed++;
      await checkpoint();
      if (processed % 25 === 0 || processed === queued.length) {
        const summary = summarize(properties, entries);
        dependencies.report?.({ processed, verified: summary.verified_count, unresolved: summary.unresolved_count, reused });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await checkpoint();
  return { ...summarize(properties, entries), processed_this_run: processed, reused_this_run: reused };
}
async function main() {
  const options = parseJurisdictionArgs(process.argv.slice(2));
  if (!options) { console.info(HELP); return; }
  const data = JSON.parse(await readFile(resolve(process.cwd(), "src/data/challenge.json"), "utf8")) as { properties: PropertyRecord[] };
  const result = await runJurisdictionEnrichment(data.properties, options, { report: summary => console.info(JSON.stringify(summary)) });
  console.info(JSON.stringify({ processed_this_run: result.processed_this_run, reused_this_run: result.reused_this_run, verified: result.verified_count, unresolved: result.unresolved_count, by_state: result.by_state, by_legal_city: result.by_legal_city, database_published: false }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => { console.error(JSON.stringify({ error_code: "JURISDICTION_ENRICHMENT_FAILED", database_published: false })); process.exitCode = 1; });
}
