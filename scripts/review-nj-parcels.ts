import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { JurisdictionResolution, NjParcelEvidence, PropertyRecord } from "../src/domain/types";
import type { JurisdictionAudit, JurisdictionAuditEntry } from "./enrich-jurisdictions";

export const NJ_PARCEL_ENDPOINT = "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query";
const METADATA = NJ_PARCEL_ENDPOINT.replace(/\/query$/, "");
const MUNICIPALITIES: Record<string, { city: string; label: string }> = {
  "0905": { city: "Hoboken", label: "HOBOKEN CITY" },
  "0906": { city: "Jersey City", label: "JERSEY CITY CITY" },
  "0714": { city: "Newark", label: "NEWARK CITY" },
};
const REQUIRED_FIELDS = ["OBJECTID", "PAMS_PIN", "PCL_MUN", "CD_CODE", "MUN_NAME", "PROP_LOC"];
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, "COUNTY", "PCLBLOCK", "PCLLOT", "PCLQCODE", "PCLLASTUPD"]);
const isoDate = z.iso.datetime({ offset: true });
const attributesSchema = z.object({
  OBJECTID: z.number().int().positive(), PAMS_PIN: z.string().min(1).max(100),
  PCL_MUN: z.string().regex(/^\d{4}$/), CD_CODE: z.string().regex(/^\d{4}$/),
  MUN_NAME: z.string().min(1).max(100), PROP_LOC: z.string().min(1).max(300),
  COUNTY: z.string().optional(), PCLBLOCK: z.string().optional(), PCLLOT: z.string().optional(),
  PCLQCODE: z.string().optional(), PCLLASTUPD: z.union([z.string(), z.number(), z.null()]).optional(),
}).strict();
const entrySchema = z.object({
  address_id: z.string().regex(/^A\d{4}$/), original_address: z.string().min(1).max(300),
  exact_full_address_match: z.literal(true), normalization: z.string(),
  municipality_from_tax_record: z.string(), municipal_code: z.string(), tax_code: z.string(), parcel: z.string(),
  attributes: attributesSchema, source_url: z.string().url(),
}).strict();
const snapshotSchema = z.object({
  retrieved_at: isoDate, official_directory: z.string().url(), official_metadata: z.literal(METADATA),
  official_authority: z.literal("https://www.nj.gov/housingcouncil/resources/data-dictionaries.shtml"),
  provider_response_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  query_url: z.string().url(), method: z.string().min(1), limitations: z.string().min(1), entries: z.array(entrySchema).min(1).max(500),
}).strict();
export type NjParcelSnapshot = z.infer<typeof snapshotSchema>;
export class NjParcelReviewError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "NjParcelReviewError"; }
}

/** Whole addresses only. Numbers, range order, suffixes and other street types stay intact. */
export function normalizeNjParcelAddress(address: string): string | null {
  if (typeof address !== "string" || !address.trim() || address.length > 300) return null;
  return address.trim().toUpperCase().replace(/\s+/g, " ").replace(/\s*-\s*/g, "-")
    .replace(/(?<=[A-Z])\.(?=\s|$)/g, "").replace(/\bAVENUE\b/g, "AVE");
}
const normalizedLabel = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

function officialQuery(value: string, objectIds: readonly number[]): boolean {
  try {
    const url = new URL(value), endpoint = new URL(NJ_PARCEL_ENDPOINT);
    if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname || url.username || url.password || url.hash) return false;
    if ([...url.searchParams.keys()].some(key => !["objectIds", "outFields", "returnGeometry", "f"].includes(key))) return false;
    if (["objectIds", "outFields", "returnGeometry", "f"].some(key => url.searchParams.getAll(key).length !== 1)) return false;
    const ids = url.searchParams.get("objectIds")!;
    if (!/^\d+(?:,\d+)*$/.test(ids)) return false;
    const actual = ids.split(",").map(Number), expected = [...new Set(objectIds)];
    if (actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(id => !expected.includes(id))) return false;
    const fields = url.searchParams.get("outFields")!.split(",");
    return fields.length === new Set(fields).size && REQUIRED_FIELDS.every(field => fields.includes(field)) && fields.every(field => ALLOWED_FIELDS.has(field)) && url.searchParams.get("returnGeometry") === "false" && url.searchParams.get("f") === "json";
  } catch { return false; }
}

export function parseNjParcelSnapshot(raw: string): { snapshot: NjParcelSnapshot; capture_sha256: string } {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new NjParcelReviewError("NJ_PARCEL_INVALID_SNAPSHOT"); }
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) throw new NjParcelReviewError("NJ_PARCEL_INVALID_SNAPSHOT");
  const snapshot = parsed.data;
  const directory = new URL(snapshot.official_directory);
  if (directory.protocol !== "https:" || !["nj.gov", "www.nj.gov"].includes(directory.hostname) || directory.pathname !== "/njgin/edata/parcels/" || directory.username || directory.password || directory.port || directory.search || directory.hash || !officialQuery(snapshot.query_url, snapshot.entries.map(entry => entry.attributes.OBJECTID))) throw new NjParcelReviewError("NJ_PARCEL_INVALID_PROVIDER");
  return { snapshot, capture_sha256: createHash("sha256").update(raw).digest("hex") };
}

function validEvidence(evidence: NjParcelEvidence, property: PropertyRecord): boolean {
  const municipality = MUNICIPALITIES[evidence.PCL_MUN];
  const original = normalizeNjParcelAddress(property.street_address), parcel = normalizeNjParcelAddress(evidence.PROP_LOC);
  return property.state === "NJ" && original !== null && original === parcel && Number.isSafeInteger(evidence.OBJECTID) && evidence.OBJECTID > 0 && typeof evidence.PAMS_PIN === "string" && evidence.PAMS_PIN.startsWith(`${evidence.PCL_MUN}_`) && !/\s/.test(evidence.PAMS_PIN) && evidence.CD_CODE === evidence.PCL_MUN && Boolean(municipality) && normalizedLabel(evidence.MUN_NAME) === municipality.label && /^[a-f0-9]{64}$/.test(evidence.capture_sha256) && /^[a-f0-9]{64}$/.test(evidence.provider_response_sha256) && isoDate.safeParse(evidence.captured_at).success && officialQuery(evidence.source_url, [evidence.OBJECTID]);
}

/** Structural check; publication must also recompute it from the fingerprinted snapshot. */
export function validNjParcelResolution(input: unknown, property: PropertyRecord): input is JurisdictionResolution {
  if (!input || typeof input !== "object") return false;
  const resolution = input as JurisdictionResolution, evidence = resolution.parcel_evidence;
  if (!evidence || typeof evidence !== "object") return false;
  try {
    return resolution.verified === true && resolution.method === "manual_review" && resolution.state === "NJ" && validEvidence(evidence, property) && resolution.legal_city === MUNICIPALITIES[evidence.PCL_MUN].city && resolution.municipality_id === `NJ:${evidence.PCL_MUN}` && resolution.source_url === evidence.source_url && resolution.resolved_at === evidence.captured_at;
  } catch { return false; }
}

export interface NjParcelReviewResult {
  resolutions: Record<string, JurisdictionResolution>;
  rejected: { address_id: string; error_code: string }[];
  capture_sha256: string; provider_response_sha256: string; captured_at: string;
}

function verifyProviderResponse(snapshot: NjParcelSnapshot, raw: string) {
  if (createHash("sha256").update(raw).digest("hex") !== snapshot.provider_response_sha256) throw new NjParcelReviewError("NJ_PARCEL_PROVIDER_HASH_MISMATCH");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new NjParcelReviewError("NJ_PARCEL_INVALID_PROVIDER_RESPONSE"); }
  const parsed = z.object({ objectIdFieldName: z.literal("OBJECTID"), features: z.array(z.object({ attributes: attributesSchema }).strict()).min(1).max(500), exceededTransferLimit: z.literal(false).optional(), error: z.never().optional() }).passthrough().safeParse(input);
  if (!parsed.success) throw new NjParcelReviewError("NJ_PARCEL_INVALID_PROVIDER_RESPONSE");
  const features = parsed.data.features;
  const seen = new Set<number>();
  for (const feature of features) {
    if (seen.has(feature.attributes.OBJECTID)) throw new NjParcelReviewError("NJ_PARCEL_AMBIGUOUS_PROVIDER_RESPONSE");
    seen.add(feature.attributes.OBJECTID);
  }
  if (features.length !== snapshot.entries.length) throw new NjParcelReviewError("NJ_PARCEL_PROVIDER_ATTRIBUTES_MISMATCH");
  for (const entry of snapshot.entries) {
    const attrs = features.find(feature => feature.attributes.OBJECTID === entry.attributes.OBJECTID)?.attributes;
    if (!attrs || Object.keys(attrs).length !== Object.keys(entry.attributes).length || Object.entries(attrs).some(([key, value]) => entry.attributes[key as keyof typeof entry.attributes] !== value)) throw new NjParcelReviewError("NJ_PARCEL_PROVIDER_ATTRIBUTES_MISMATCH");
  }
}

/** Recompute both exact file hashes and each parcel attribute before considering any resolution. */
export function reviewNjParcelSnapshot(raw: string, properties: readonly PropertyRecord[], providerResponseRaw: string): NjParcelReviewResult {
  const { snapshot, capture_sha256 } = parseNjParcelSnapshot(raw);
  verifyProviderResponse(snapshot, providerResponseRaw);
  const result: NjParcelReviewResult = { resolutions: {}, rejected: [], capture_sha256, provider_response_sha256: snapshot.provider_response_sha256, captured_at: snapshot.retrieved_at };
  const propertyMap = new Map(properties.map(property => [property.address_id, property]));
  for (const id of new Set(snapshot.entries.map(entry => entry.address_id))) {
    const candidates = snapshot.entries.filter(entry => entry.address_id === id), property = propertyMap.get(id);
    const reject = (code: string) => result.rejected.push({ address_id: id, error_code: code });
    if (!property || property.state !== "NJ") { reject("NJ_PARCEL_INVALID_PROPERTY"); continue; }
    const fullAddress = normalizeNjParcelAddress(property.street_address);
    // Never select one parcel among several, including same-city parcels or duplicate capture rows.
    if (candidates.length !== 1 || snapshot.entries.filter(entry => normalizeNjParcelAddress(entry.attributes.PROP_LOC) === fullAddress).length !== 1) { reject("NJ_PARCEL_AMBIGUOUS_MATCH"); continue; }
    const entry = candidates[0], attrs = entry.attributes;
    if (entry.original_address !== property.street_address || entry.municipality_from_tax_record !== attrs.MUN_NAME || entry.municipal_code !== attrs.PCL_MUN || entry.tax_code !== attrs.CD_CODE || entry.parcel !== attrs.PAMS_PIN) { reject("NJ_PARCEL_INCONSISTENT_SNAPSHOT"); continue; }
    const evidence: NjParcelEvidence = { PROP_LOC: attrs.PROP_LOC, OBJECTID: attrs.OBJECTID, PAMS_PIN: attrs.PAMS_PIN, PCL_MUN: attrs.PCL_MUN, CD_CODE: attrs.CD_CODE, MUN_NAME: attrs.MUN_NAME, source_url: entry.source_url, capture_sha256, provider_response_sha256: snapshot.provider_response_sha256, captured_at: snapshot.retrieved_at };
    const resolution: JurisdictionResolution = {
      state: "NJ", legal_city: MUNICIPALITIES[attrs.PCL_MUN]?.city ?? "", verified: true, method: "manual_review",
      resolved_at: evidence.captured_at, source_url: evidence.source_url, municipality_id: `NJ:${attrs.PCL_MUN}`, parcel_evidence: evidence,
      note: "Agent-assisted review of the official NJ OGIS/MOD-IV parcel: complete property address and matching municipal tax code/name. NJ municipal code is not a Census GEOID. Parcel tax assignment supports current municipal identification; it does not independently prove historical boundaries, ownership/title, rent-control status or a certificate date.",
    };
    if (!validNjParcelResolution(resolution, property)) { reject("NJ_PARCEL_EVIDENCE_MISMATCH"); continue; }
    result.resolutions[id] = resolution;
  }
  return result;
}

export interface NjParcelReviewOptions { snapshot: string; providerResponse: string; outputDir: string; write: boolean }
export function parseNjParcelReviewArgs(args: readonly string[], cwd = process.cwd()): NjParcelReviewOptions | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  const options = { snapshot: resolve(cwd, "corpus/nj-parcel-evidence.json"), providerResponse: resolve(cwd, "corpus/nj-parcel-provider-response.json"), outputDir: resolve(cwd, "corpus"), write: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new NjParcelReviewError("NJ_PARCEL_INVALID_ARGUMENT"); seen.add(flag);
    if (flag === "--write" || flag === "--apply" || flag === "--plan") {
      if (["--write", "--apply", "--plan"].some(other => other !== flag && seen.has(other))) throw new NjParcelReviewError("NJ_PARCEL_INVALID_ARGUMENT");
      options.write = flag !== "--plan"; continue;
    }
    if (!["--snapshot", "--provider-response", "--output-dir"].includes(flag)) throw new NjParcelReviewError("NJ_PARCEL_INVALID_ARGUMENT");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new NjParcelReviewError("NJ_PARCEL_INVALID_ARGUMENT");
    if (flag === "--snapshot") options.snapshot = resolve(cwd, value); else if (flag === "--provider-response") options.providerResponse = resolve(cwd, value); else options.outputDir = resolve(cwd, value);
  }
  return options;
}

async function writeJsonAtomic(file: string, data: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n"); await rename(temporary, file);
}
async function writeReview(result: NjParcelReviewResult, properties: readonly PropertyRecord[], outputDir: string) {
  if (result.rejected.length) throw new NjParcelReviewError("NJ_PARCEL_UNRESOLVED_REVIEW");
  // This separate local review never calls the Census resolver or replaces its accepted rows.
  const { jurisdictionInputHash, validResolution } = await import("./enrich-jurisdictions");
  const auditPath = join(outputDir, "jurisdiction-audit.json"), resolutionPath = join(outputDir, "jurisdiction-resolutions.json");
  const audit = JSON.parse(await readFile(auditPath, "utf8")) as JurisdictionAudit;
  const existing = JSON.parse(await readFile(resolutionPath, "utf8")) as Record<string, JurisdictionResolution>;
  if (!audit.entries || !audit.parser_version || audit.total_properties !== properties.length) throw new NjParcelReviewError("NJ_PARCEL_INVALID_EXISTING_AUDIT");
  const merged = { ...existing }, entries = { ...audit.entries }, written: string[] = [];
  for (const property of properties) {
    const resolution = result.resolutions[property.address_id];
    if (!resolution) continue;
    if (existing[property.address_id]) {
      if (!validResolution(existing[property.address_id], property)) throw new NjParcelReviewError("NJ_PARCEL_INVALID_EXISTING_RESOLUTION");
      continue;
    }
    const old = entries[property.address_id];
    if (!old || old.input_hash !== jurisdictionInputHash(property)) throw new NjParcelReviewError("NJ_PARCEL_STALE_PROPERTY_AUDIT");
    const entry: JurisdictionAuditEntry = { ...old, status: "verified", checked_at: result.captured_at, resolution,
      attempts: [...old.attempts, { city_hint: resolution.parcel_evidence!.MUN_NAME, zip_used: "", outcome: "verified_nj_parcel_full_address" }], note: resolution.note };
    delete entry.error_code;
    entries[property.address_id] = entry; merged[property.address_id] = resolution; written.push(property.address_id);
  }
  const verified = properties.filter(property => validResolution(merged[property.address_id], property));
  const by_state = Object.fromEntries(["CA", "NJ", "MA"].map(state => {
    const total = properties.filter(property => property.state === state).length, count = verified.filter(property => property.state === state).length;
    return [state, { total, verified: count, unresolved: total - count }];
  }));
  const by_legal_city: Record<string, number> = {};
  for (const property of verified) { const key = `${merged[property.address_id].legal_city}, ${property.state}`; by_legal_city[key] = (by_legal_city[key] ?? 0) + 1; }
  const updated = { ...audit, generated_at: new Date().toISOString(), verified_count: verified.length, unresolved_count: properties.length - verified.length, by_state, by_legal_city, entries,
    method_note: audit.method_note.includes("Supplemental NJ parcel review") ? audit.method_note : audit.method_note + " Supplemental NJ parcel review uses exact complete PROP_LOC addresses and agreeing municipal code/name from the official OGIS/MOD-IV layer; ambiguous or endpoint-only matches remain unresolved. Original Census rows are preserved." };
  await mkdir(outputDir, { recursive: true });
  await writeJsonAtomic(resolutionPath, merged); await writeJsonAtomic(auditPath, updated);
  await writeJsonAtomic(join(outputDir, "nj-parcel-review.json"), { ...result, added_address_ids: written, database_accessed: false, network_requested: false });
  return written;
}
const HELP = `Review captured official NJ parcel evidence locally, without network or database access.
Usage: node --import tsx scripts/review-nj-parcels.ts [--snapshot corpus/nj-parcel-evidence.json] [--plan]
       node --import tsx scripts/review-nj-parcels.ts --apply
--plan is the default: validate and report without writes.
--apply adds accepted unresolved records to the existing local jurisdiction audit;
accepted Census rows are preserved. Rebuild and explicit publication are separate steps.`;
async function main() {
  const options = parseNjParcelReviewArgs(process.argv.slice(2));
  if (!options) { console.info(HELP); return; }
  const data = JSON.parse(await readFile(resolve(process.cwd(), "src/data/challenge.json"), "utf8")) as { properties: PropertyRecord[] };
  const result = reviewNjParcelSnapshot(await readFile(options.snapshot, "utf8"), data.properties, await readFile(options.providerResponse, "utf8"));
  const added = options.write ? await writeReview(result, data.properties, options.outputDir) : [];
  console.info(JSON.stringify({ accepted: Object.keys(result.resolutions).length, rejected: result.rejected, added_address_ids: added, capture_sha256: result.capture_sha256, captured_at: result.captured_at, wrote_local_audit: options.write, network_requested: false, database_accessed: false }, null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => { console.error(JSON.stringify({ error_code: error instanceof NjParcelReviewError ? error.code : "NJ_PARCEL_REVIEW_FAILED", network_requested: false, database_accessed: false })); process.exitCode = 1; });
}
