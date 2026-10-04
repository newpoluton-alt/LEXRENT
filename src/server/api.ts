import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { createHash } from "node:crypto";
import { CATEGORIES, DEFAULT_AS_OF, FACT_FIELDS, changeFixtures, evaluateChanges, evaluateProperty, exportSubmissions, getDashboard, getCoverageReport, getProperty, getSource, getSources, properties, queryDateSchema, searchProperties, validateRuleBundle, type FactRecord } from "@/domain";
import { assertSameOrigin, AuthError, getSession, isAdmin, isAuthConfigured, requireAdmin, requireUser } from "./auth";
import { appendAudit, createEvaluationRun, DatabaseError, deleteSavedProperty, getEvaluationRun, isDatabaseConfigured, listAuditRecords, listEvaluationRuns, listSavedProperties, saveJurisdictionResolution, saveProperty, saveRuleBundle, saveSourceCapture } from "./db";
import { loadContext } from "./context";
import { AiError, isAiConfigured } from "./ai";
import { extractWithPersistence, reserveAiRequest } from "./extraction-store";
import { answerQuestion, chatQuestionSchema, getCurrentKnowledgeChunks } from "./chat";
import { JurisdictionError, resolveJurisdiction } from "./jurisdiction";
import { syncVectorCorpus, VectorStoreError } from "./vector-store";
import { vectorModelInfo } from "../domain/vector-embedding";

const addressId = z.string().min(1).max(100);
const factsSchema = z.object({
  year_built: z.number().int().min(1000).max(2300).nullable().optional(), units: z.number().int().min(1).max(100000).nullable().optional(),
  certificate_of_occupancy_date: queryDateSchema.nullable().optional(), owner_type: z.string().min(1).max(100).nullable().optional(),
  owner_occupied: z.boolean().nullable().optional(), owner_total_properties: z.number().int().min(0).nullable().optional(), owner_total_units: z.number().int().min(0).nullable().optional(),
  tenancy_months: z.number().min(0).max(2000).nullable().optional(), construction_exemption_filed: z.boolean().nullable().optional(),
  is_subsidized: z.boolean().nullable().optional(), is_single_family: z.boolean().nullable().optional(), residential_use: z.boolean().nullable().optional(),
  ...Object.fromEntries(FACT_FIELDS.filter(field => !["year_built", "units", "certificate_of_occupancy_date", "certificate_age_years", "owner_type", "owner_total_properties", "owner_total_units", "tenancy_months", "state", "legal_city"].includes(field)).map(field => [field, z.boolean().nullable().optional()])),
}).strict();
const lookupSchema = z.object({ address_id: addressId, as_of: queryDateSchema.default(DEFAULT_AS_OF), facts: factsSchema.optional(), persist: z.boolean().optional() }).strict();
const savedSchema = z.object({ address_id: addressId, label: z.string().max(200).optional() }).strict();
const app = new Hono().basePath("/api");
app.use("*", bodyLimit({ maxSize: 2_000_000, onError: c => c.json({ error: "BODY_TOO_LARGE", message: "Please submit a file smaller than 2 MB." }, 413) }));
app.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) assertSameOrigin(c.req.raw); await next(); });
app.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: "INVALID_INPUT", message: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, 400);
  if (error instanceof AuthError || error instanceof DatabaseError || error instanceof AiError || error instanceof JurisdictionError || error instanceof VectorStoreError) return c.json({ error: error.code, message: error.message }, error.status as 400);
  if (error instanceof SyntaxError) return c.json({ error: "INVALID_JSON", message: "Provide valid JSON." }, 400);
  console.error("LEXRENT request failed", { name: error.name });
  return c.json({ error: "REQUEST_FAILED", message: "This request could not be completed. Please try again." }, 500);
});
app.notFound(c => c.json({ error: "NOT_FOUND", message: "This endpoint does not exist." }, 404));

app.get("/health", c => c.json({ status: "ok", app: "LEXRENT" }));
app.get("/capabilities", c => c.json({ auth: { configured: isAuthConfigured() }, database: { configured: isDatabaseConfigured() }, ai: { configured: isAiConfigured(), model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5", requires_review: true, retrieval: { engine: "neon_pgvector", method: "lsa_keyword_hybrid", dimensions: vectorModelInfo.dimensions, embedding_api_required: false } } }));
app.get("/me", async c => { const session = await getSession(); return c.json({ user: session?.user ?? null, auth_configured: isAuthConfigured(), is_admin: !!session && isAdmin(session.user) }); });
app.get("/dashboard", async c => {
  const { context, createdAt } = await loadContext(); const dashboard = getDashboard(context);
  return c.json({ ...dashboard, counts: { properties: dashboard.property_count, sources: dashboard.source_count, captured_sources: dashboard.captured_source_count, rules: dashboard.verified_rule_count, jurisdictions: new Set(properties.map(p => p.legal_city_candidate)).size }, latest_import: createdAt });
});
app.get("/coverage", async c => { const { context, bundleId } = await loadContext(); return c.json({ ...getCoverageReport(context), rule_bundle_id: bundleId }); });
app.get("/properties", c => {
  const query = z.object({ q: z.string().max(300).default(""), state: z.enum(["", "CA", "NJ", "MA"]).default(""), page: z.coerce.number().int().min(1).max(500).default(1), limit: z.coerce.number().int().min(1).max(100).default(12) }).parse(c.req.query());
  return c.json({ ...searchProperties(query.q, { state: query.state || undefined, limit: query.limit, offset: (query.page - 1) * query.limit }), page: query.page });
});
app.post("/lookup", async c => {
  const input = lookupSchema.parse(await c.req.json()); const { context, bundleId } = await loadContext();
  if (input.facts) context.propertyOverrides = { [input.address_id]: input.facts as FactRecord };
  const result = evaluateProperty(input.address_id, input.as_of, context);
  if (!result) return c.json({ error: "NOT_FOUND", message: "That property is not in this corpus." }, 404);
  let runId: string | null = null;
  if (input.persist) { const user = await requireUser(c.req.raw); const run = await createEvaluationRun(user, { asOf: input.as_of, ruleBundleId: bundleId ?? undefined, inputs: result.input_snapshot, results: result, summary: { address_id: input.address_id } }); runId = run.id; }
  return c.json({ ...result, address: result.property, results: result.rules, notes: result.notices, rule_bundle_id: bundleId, run_id: runId });
});
app.get("/sources", async c => { const { context, evidenceNeedsReview } = await loadContext({ allowEvidenceRepair: true }); return c.json({ ...getSources({ query: c.req.query("q"), limit: 100 }, context), evidence_needs_review: evidenceNeedsReview }); });
app.get("/sources/:doc_id", async c => {
  const { context } = await loadContext({ allowEvidenceRepair: true }); const source = getSource(c.req.param("doc_id"), context);
  return source ? c.json({ source, text: source.text ?? null }) : c.json({ error: "NOT_FOUND", message: "That source does not exist." }, 404);
});
app.get("/changes", async c => { const { context } = await loadContext(); return c.json({ tests: changeFixtures, evaluations: evaluateChanges(context) }); });
app.post("/changes/:test_id", async c => {
  z.object({ as_of: queryDateSchema.optional() }).strict().parse(await c.req.json());
  const { context } = await loadContext(); const result = evaluateChanges(context).find(item => item.test_id === c.req.param("test_id"));
  return result ? c.json(result) : c.json({ error: "NOT_FOUND", message: "That change case does not exist." }, 404);
});
app.get("/exports/:kind", async c => {
  const kind = z.enum(["rules", "lookups", "changes", "readiness"]).parse(c.req.param("kind"));
  const asOf = queryDateSchema.parse(c.req.query("as_of") ?? DEFAULT_AS_OF); const { context } = await loadContext(); const exports = exportSubmissions(asOf, context);
  c.header("Content-Type", "application/json; charset=utf-8"); c.header("Content-Disposition", `attachment; filename="${kind}.json"`);
  c.header("X-LEXRENT-Submission-Ready", String(exports.readiness.ready));
  return c.body(JSON.stringify(exports[kind], null, 2));
});
app.get("/saved", async c => { const user = await requireUser(); return c.json({ saved: (await listSavedProperties(user)).map(item => ({ address_id: item.addressId, property: item.snapshot, label: item.label, created_at: item.createdAt })) }); });
app.post("/saved", async c => { const user = await requireUser(c.req.raw); const input = savedSchema.parse(await c.req.json()); const property = getProperty(input.address_id); if (!property) return c.json({ error: "NOT_FOUND", message: "That property does not exist." }, 404); return c.json(await saveProperty(user, { addressId: input.address_id, label: input.label, snapshot: property }), 201); });
app.delete("/saved", async c => { const user = await requireUser(c.req.raw); const input = savedSchema.parse(await c.req.json()); return c.json({ deleted: await deleteSavedProperty(user, input.address_id) }); });
app.get("/runs", async c => c.json({ runs: await listEvaluationRuns(await requireUser()) }));
app.get("/runs/:id", async c => { const run = await getEvaluationRun(await requireUser(), c.req.param("id")); return run ? c.json(run) : c.json({ error: "NOT_FOUND", message: "That evaluation is not in your workspace." }, 404); });
app.get("/admin/audit", async c => c.json({ records: await listAuditRecords(await requireAdmin()) }));
app.post("/admin/vector-index", async c => {
  const user = await requireAdmin(c.req.raw);
  z.object({}).strict().parse(await c.req.json());
  const { context } = await loadContext({ allowEvidenceRepair: true });
  const result = await syncVectorCorpus(getCurrentKnowledgeChunks(context), context.sources ?? []);
  await appendAudit(user, { action: "ai.vector.index", entityType: "source_index", entityId: result.fingerprint, metadata: { model: result.model, dimensions: result.dimensions, indexed_chunks: result.indexed_chunk_count } });
  return c.json(result);
});
app.post("/admin/rules", async c => {
  const user = await requireAdmin(c.req.raw); const input = z.object({ rules: z.array(z.unknown()).min(1).max(5000), ruleLogic: z.record(z.string(), z.unknown()).optional(), logic: z.record(z.string(), z.unknown()).optional(), name: z.string().min(1).max(200).optional(), mode: z.enum(["merge", "replace"]).default("merge") }).strict().parse(await c.req.json());
  const { context } = await loadContext({ allowEvidenceRepair: true });
  const rules = input.mode === "replace" ? input.rules : [...(context.rules ?? []).filter(rule => !input.rules.some(incoming => (incoming as { team_rule_id?: unknown })?.team_rule_id === rule.team_rule_id)), ...input.rules];
  const ruleLogic = { ...(input.mode === "replace" ? {} : context.ruleLogic), ...(input.ruleLogic ?? input.logic ?? {}) };
  const validation = validateRuleBundle({ rules, ruleLogic }, context.sources);
  if (!validation.valid || !validation.bundle) return c.json({ error: "INVALID_RULES", message: validation.errors.map(issue => `${issue.path}: ${issue.message}`).join("; "), issues: validation.errors }, 422);
  const referencedSources = (context.sources ?? []).filter(source => validation.bundle!.rules.some(rule => rule.source_doc_id === source.doc_id));
  const sourceVersions = Object.fromEntries(referencedSources.map(source => [source.doc_id, { url: source.url, text: source.text, sha256: source.sha256, retrieved_at: source.retrieved_at }]));
  const bundle = await saveRuleBundle(user, { name: input.name ?? "Reviewed rule import", rules: validation.bundle.rules, metadata: { ruleLogic: validation.bundle.ruleLogic, categories: CATEGORIES, source_versions: sourceVersions, reviewed_at: new Date().toISOString() } });
  return c.json({ imported: input.rules.length, count: bundle.rules.length, bundle_id: bundle.id, warnings: validation.warnings, message: `${input.rules.length} records imported after source and schema validation.` }, 201);
});
app.post("/admin/sources/:doc_id", async c => {
  const user = await requireAdmin(c.req.raw); const source = getSource(c.req.param("doc_id")); if (!source) return c.json({ error: "NOT_FOUND", message: "Use a document ID from the source manifest." }, 404);
  const input = z.object({ text: z.string().min(20).max(1_000_000), source_url: z.url(), retrieved_at: z.iso.datetime() }).strict().parse(await c.req.json());
  if (input.source_url !== source.url) return c.json({ error: "SOURCE_MISMATCH", message: "The capture URL must match the source manifest." }, 422);
  const capture = await saveSourceCapture(user, source.doc_id, input); return c.json({ doc_id: source.doc_id, sha256: capture.hash, captured: true }, 201);
});
app.post("/admin/jurisdictions/:address_id", async c => {
  const user = await requireAdmin(c.req.raw); const property = getProperty(c.req.param("address_id")); if (!property) return c.json({ error: "NOT_FOUND", message: "That property does not exist." }, 404);
  const resolution = await resolveJurisdiction(property); await saveJurisdictionResolution(user, property.address_id, resolution); return c.json(resolution);
});
app.post("/ai/extract", async c => {
  const user = await requireAdmin(c.req.raw);
  const input = z.object({ doc_ids: z.array(z.string().regex(/^D\d{3}$/)).min(1).max(1), chunk: z.number().int().min(0).max(1000).default(0) }).strict().parse(await c.req.json());
  const { context } = await loadContext({ allowEvidenceRepair: true }); const source = getSource(input.doc_ids[0], context); if (!source) return c.json({ error: "NOT_FOUND", message: "That source does not exist." }, 404);
  const result = await extractWithPersistence(source, input.chunk, user);
  await appendAudit(user, { action: "ai.extract.draft", entityType: "source", entityId: source.doc_id, metadata: { chunk: result.chunk, count: result.bundle.rules.length, source_hash: source.sha256, draft_hash: createHash("sha256").update(JSON.stringify(result.bundle)).digest("hex") } });
  return c.json({ ...result, rules: result.bundle.rules, ruleLogic: result.bundle.ruleLogic, count: result.bundle.rules.length, message: "Draft extracted. Review applicability, exemptions, status, and evidence before importing." });
});
app.post("/ai/chat", async c => {
  const user = await requireUser(c.req.raw); const input = chatQuestionSchema.parse(await c.req.json());
  if (!isAiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "Claude answers are not configured in this environment.", 503);
  if (input.address_id && !getProperty(input.address_id)) return c.json({ error: "NOT_FOUND", message: "That property does not exist in the supplied corpus." }, 404);
  const { context } = await loadContext();
  const requestHash = createHash("sha256").update(JSON.stringify([input.question, input.address_id, input.as_of])).digest("hex");
  await reserveAiRequest(user, `chat:${requestHash}`, { perUserLimit: 20, totalLimit: 200, requireAdmin: false });
  const answer = await answerQuestion(input, context);
  await appendAudit(user, { action: "ai.chat.answer", entityType: "research", metadata: { sources_used: answer.sources_used, as_of: answer.as_of, address_id: answer.address_id, model: answer.model } });
  return c.json(answer);
});
export { app };
