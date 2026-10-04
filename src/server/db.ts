import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { AuthError, isAdmin, type AuthUser } from "./auth";

export class DatabaseError extends Error {
  constructor(
    public readonly code: "DATABASE_NOT_CONFIGURED" | "DATABASE_UNAVAILABLE" | "INVALID_INPUT",
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

type Row = Record<string, unknown>;
type Sql = NeonQueryFunction<false, false>;
let connection: Sql | undefined;
let connectionUrl: string | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/** Server credentials never leave this module and are never included in errors. */
export function getDatabase(): Sql {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new DatabaseError("DATABASE_NOT_CONFIGURED", "Online saving is unavailable until Neon Postgres is configured.");
  }
  if (!connection || connectionUrl !== url) {
    try {
      connection = neon(url);
      connectionUrl = url;
    } catch {
      throw new DatabaseError("DATABASE_NOT_CONFIGURED", "The database configuration is invalid.");
    }
  }
  return connection;
}

async function query<T extends Row>(statement: string, parameters: unknown[] = []): Promise<T[]> {
  const sql = getDatabase();
  try {
    return await sql.query(statement, parameters) as T[];
  } catch {
    throw new DatabaseError("DATABASE_UNAVAILABLE", "The database is temporarily unavailable. Your changes were not confirmed.");
  }
}

function ensureUser(actor: AuthUser): void {
  if (!actor?.id || !actor.email) throw new AuthError("UNAUTHENTICATED", "Sign in to access saved data.", 401);
}

function ensureAdmin(actor: AuthUser): void {
  ensureUser(actor);
  if (!isAdmin(actor)) throw new AuthError("FORBIDDEN", "A verified administrator account is required.", 403);
}

function json(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error();
    return encoded;
  } catch {
    throw new DatabaseError("INVALID_INPUT", "The data must be valid JSON.", 400);
  }
}

function requiredText(value: string, field: string, limit = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new DatabaseError("INVALID_INPUT", `${field} is missing or too long.`, 400);
  }
  return value.trim();
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DatabaseError("INVALID_INPUT", "The record ID is invalid.", 400);
  }
  return value;
}

function timestamp(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

export interface RuleBundle {
  id: string;
  name: string;
  sourceFile: string | null;
  sha256: string;
  rules: unknown[];
  metadata: unknown;
  verifiedByUserId: string;
  createdAt: string;
}

function bundle(row: Row): RuleBundle {
  return {
    id: String(row.id), name: String(row.name), sourceFile: row.source_file as string | null,
    sha256: String(row.sha256), rules: row.rules as unknown[], metadata: row.metadata,
    verifiedByUserId: String(row.verified_by_user_id), createdAt: timestamp(row.created_at),
  };
}

export async function saveRuleBundle(
  actor: AuthUser,
  input: { name: string; rules: unknown[]; sourceFile?: string; metadata?: unknown },
): Promise<RuleBundle> {
  ensureAdmin(actor);
  const name = requiredText(input.name, "Bundle name", 200);
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new DatabaseError("INVALID_INPUT", "A rule bundle must contain at least one validated rule.", 400);
  }
  const rules = json(input.rules);
  const metadata = json(input.metadata ?? {});
  // Metadata carries the normalized ruleLogic and captured evidence. Hash both,
  // so changing coverage logic never silently reuses a previous rule snapshot.
  const sha256 = createHash("sha256").update(rules).update("\n").update(metadata).digest("hex");
  const rows = await query(
    `WITH inserted AS (
      INSERT INTO lexrent_rule_bundles (name, source_file, sha256, rules, metadata, verified_by_user_id)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
      RETURNING *
    ), audit AS (
      INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id, metadata)
      SELECT $6, 'rule_bundle.import', 'rule_bundle', id::text, jsonb_build_object('sha256', sha256, 'ruleCount', jsonb_array_length(rules))
      FROM inserted
    ) SELECT * FROM inserted`,
    [name, input.sourceFile ?? null, sha256, rules, metadata, actor.id],
  );
  return bundle(rows[0]);
}

export async function listRuleBundles(): Promise<RuleBundle[]> {
  return (await query("SELECT * FROM lexrent_rule_bundles ORDER BY created_at DESC, id DESC")).map(bundle);
}

/** Public evaluation loads one complete snapshot without fetching import history. */
export async function getLatestRuleBundle(): Promise<RuleBundle | null> {
  const rows = await query("SELECT * FROM lexrent_rule_bundles ORDER BY created_at DESC, id DESC LIMIT 1");
  return rows[0] ? bundle(rows[0]) : null;
}

export async function getRuleBundle(id: string): Promise<RuleBundle | null> {
  const rows = await query("SELECT * FROM lexrent_rule_bundles WHERE id = $1::uuid", [uuid(id)]);
  return rows[0] ? bundle(rows[0]) : null;
}

export interface EvaluationRun {
  id: string;
  ownerUserId: string;
  name: string | null;
  asOf: string;
  ruleBundleId: string | null;
  inputs: unknown;
  results: unknown;
  summary: unknown;
  createdAt: string;
}

function run(row: Row): EvaluationRun {
  return {
    id: String(row.id), ownerUserId: String(row.owner_user_id), name: row.name as string | null,
    asOf: String(row.as_of).slice(0, 10), ruleBundleId: row.rule_bundle_id as string | null,
    inputs: row.input_snapshot, results: row.results, summary: row.summary, createdAt: timestamp(row.created_at),
  };
}

export async function createEvaluationRun(
  actor: AuthUser,
  input: { asOf: string; ruleBundleId?: string | null; inputs: unknown; results: unknown; summary?: unknown; name?: string },
): Promise<EvaluationRun> {
  ensureUser(actor);
  const queryDate = new Date(input.asOf);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) ||
    !Number.isFinite(queryDate.getTime()) ||
    queryDate.toISOString().slice(0, 10) !== input.asOf
  ) {
    throw new DatabaseError("INVALID_INPUT", "The query date is invalid.", 400);
  }
  const rows = await query(
    `WITH inserted AS (
      INSERT INTO lexrent_evaluation_runs (owner_user_id, name, as_of, rule_bundle_id, input_snapshot, results, summary)
      VALUES ($1, $2, $3::date, $4::uuid, $5::jsonb, $6::jsonb, $7::jsonb) RETURNING *
    ), audit AS (
      INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id, metadata)
      SELECT $1, 'evaluation.create', 'evaluation_run', id::text, jsonb_build_object('asOf', as_of, 'ruleBundleId', rule_bundle_id)
      FROM inserted
    ) SELECT * FROM inserted`,
    [actor.id, input.name ?? null, input.asOf, input.ruleBundleId ? uuid(input.ruleBundleId) : null, json(input.inputs), json(input.results), json(input.summary ?? {})],
  );
  return run(rows[0]);
}

export async function listEvaluationRuns(actor: AuthUser): Promise<EvaluationRun[]> {
  ensureUser(actor);
  return (await query("SELECT * FROM lexrent_evaluation_runs WHERE owner_user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100", [actor.id])).map(run);
}

export async function getEvaluationRun(actor: AuthUser, id: string): Promise<EvaluationRun | null> {
  ensureUser(actor);
  const rows = await query("SELECT * FROM lexrent_evaluation_runs WHERE id = $1::uuid AND owner_user_id = $2", [uuid(id), actor.id]);
  return rows[0] ? run(rows[0]) : null;
}

export interface SavedProperty {
  addressId: string;
  label: string | null;
  collectionName: string;
  snapshot: unknown;
  createdAt: string;
  updatedAt: string;
}

function saved(row: Row): SavedProperty {
  return {
    addressId: String(row.address_id), label: row.label as string | null,
    collectionName: String(row.collection_name), snapshot: row.property_snapshot,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
  };
}

export async function saveProperty(
  actor: AuthUser,
  input: { addressId: string; label?: string; snapshot: unknown; collectionName?: string },
): Promise<SavedProperty> {
  ensureUser(actor);
  const addressId = requiredText(input.addressId, "Property ID", 100);
  const collectionName = requiredText(input.collectionName ?? "Saved properties", "Collection name", 200);
  const rows = await query(
    `WITH inserted AS (
      INSERT INTO lexrent_saved_properties (owner_user_id, address_id, label, collection_name, property_snapshot)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (owner_user_id, address_id) DO UPDATE
      SET label = EXCLUDED.label, collection_name = EXCLUDED.collection_name,
          property_snapshot = EXCLUDED.property_snapshot, updated_at = now()
      RETURNING *
    ), audit AS (
      INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id)
      VALUES ($1, 'property.save', 'property', $2)
    ) SELECT * FROM inserted`,
    [actor.id, addressId, input.label ?? null, collectionName, json(input.snapshot)],
  );
  return saved(rows[0]);
}

export async function listSavedProperties(actor: AuthUser): Promise<SavedProperty[]> {
  ensureUser(actor);
  return (await query("SELECT * FROM lexrent_saved_properties WHERE owner_user_id = $1 ORDER BY updated_at DESC, address_id", [actor.id])).map(saved);
}

export async function deleteSavedProperty(actor: AuthUser, addressId: string): Promise<boolean> {
  ensureUser(actor);
  const rows = await query(
    `WITH removed AS (
      DELETE FROM lexrent_saved_properties WHERE owner_user_id = $1 AND address_id = $2 RETURNING address_id
    ), audit AS (
      INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id)
      SELECT $1, 'property.delete', 'property', address_id FROM removed
    ) SELECT address_id FROM removed`,
    [actor.id, requiredText(addressId, "Property ID", 100)],
  );
  return rows.length > 0;
}

export interface AuditRecord {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

function auditRecord(row: Row): AuditRecord {
  return {
    id: String(row.id), actorUserId: row.actor_user_id as string | null,
    action: String(row.action), entityType: String(row.entity_type), entityId: row.entity_id as string | null,
    metadata: row.metadata, createdAt: timestamp(row.created_at),
  };
}

export async function appendAudit(
  actor: AuthUser | null,
  input: { action: string; entityType: string; entityId?: string; metadata?: unknown },
): Promise<AuditRecord> {
  if (actor) ensureUser(actor);
  const rows = await query(
    "INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *",
    [actor?.id ?? null, requiredText(input.action, "Action", 100), requiredText(input.entityType, "Entity type", 100), input.entityId ?? null, json(input.metadata ?? {})],
  );
  return auditRecord(rows[0]);
}

export async function listAuditRecords(actor: AuthUser): Promise<AuditRecord[]> {
  ensureAdmin(actor);
  return (await query("SELECT * FROM lexrent_audit_records ORDER BY created_at DESC, id DESC LIMIT 250")).map(auditRecord);
}

export async function getJurisdictionResolutions(): Promise<Record<string, unknown>> {
  const rows = await query("SELECT address_id, resolution FROM lexrent_jurisdiction_resolutions ORDER BY address_id");
  return Object.fromEntries(rows.map((row) => [String(row.address_id), row.resolution]));
}

export async function saveJurisdictionResolution(actor: AuthUser, addressId: string, resolution: unknown): Promise<void> {
  ensureAdmin(actor);
  await query(
    `WITH saved AS (
      INSERT INTO lexrent_jurisdiction_resolutions (address_id, resolution, verified_by_user_id)
      VALUES ($1, $2::jsonb, $3) ON CONFLICT (address_id) DO UPDATE
      SET resolution = EXCLUDED.resolution, verified_by_user_id = EXCLUDED.verified_by_user_id, updated_at = now()
    ) INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES ($3, 'jurisdiction.resolve', 'property', $1, $2::jsonb)`,
    [requiredText(addressId, "Property ID", 100), json(resolution), actor.id],
  );
}

export interface SourceCapture {
  id: string;
  docId: string;
  text: string;
  source_url: string;
  retrieved_at: string;
  hash: string;
  createdAt: string;
}

function capture(row: Row): SourceCapture {
  return {
    id: String(row.id), docId: String(row.doc_id), text: String(row.source_text),
    source_url: String(row.source_url), retrieved_at: timestamp(row.retrieved_at),
    hash: String(row.sha256), createdAt: timestamp(row.created_at),
  };
}

/** Latest capture per document; older versions remain preserved in Postgres. */
export async function listSourceCaptures(): Promise<SourceCapture[]> {
  return (await query("SELECT DISTINCT ON (doc_id) * FROM lexrent_source_captures ORDER BY doc_id, created_at DESC, id DESC")).map(capture);
}

export async function saveSourceCapture(
  actor: AuthUser,
  docId: string,
  input: { text: string; source_url: string; retrieved_at: string; hash?: string },
): Promise<SourceCapture> {
  ensureAdmin(actor);
  const sourceUrl = requiredText(input.source_url, "Source URL", 3000);
  try {
    if (!["https:", "http:"].includes(new URL(sourceUrl).protocol)) throw new Error();
  } catch {
    throw new DatabaseError("INVALID_INPUT", "The source URL is invalid.", 400);
  }
  const retrievedAt = new Date(input.retrieved_at);
  if (!Number.isFinite(retrievedAt.getTime()) || typeof input.text !== "string" || !input.text.trim()) {
    throw new DatabaseError("INVALID_INPUT", "A source capture needs text and a valid retrieval date.", 400);
  }
  const sha256 = createHash("sha256").update(input.text).digest("hex");
  const rows = await query(
    `WITH inserted AS (
      INSERT INTO lexrent_source_captures (doc_id, source_url, retrieved_at, sha256, source_text, verified_by_user_id)
      VALUES ($1, $2, $3::timestamptz, $4, $5, $6)
      ON CONFLICT (doc_id, sha256) DO UPDATE SET sha256 = EXCLUDED.sha256 RETURNING *
    ), audit AS (
      INSERT INTO lexrent_audit_records (actor_user_id, action, entity_type, entity_id, metadata)
      SELECT $6, 'source.capture', 'source', $1, jsonb_build_object('sha256', sha256, 'sourceUrl', source_url) FROM inserted
    ) SELECT * FROM inserted`,
    [requiredText(docId, "Source document ID", 100), sourceUrl, retrievedAt.toISOString(), sha256, input.text, actor.id],
  );
  return capture(rows[0]);
}
