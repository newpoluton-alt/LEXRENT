import { AiError, extractSourceChunk, getExtractionIdentity, isAiConfigured, type ExtractionResult } from "./ai";
import { AuthError, isAdmin, type AuthUser } from "./auth";
import { getDatabase } from "./db";
import { validateRuleBundle } from "../domain/validation";
import type { SourceDocument } from "../domain/types";

const GLOBAL_BUDGET_LOCK = 197505;
const ADMIN_ATTEMPTS_PER_HOUR = 60, TOTAL_ATTEMPTS_PER_HOUR = 200;

export interface AiBudgetOptions { perUserLimit?: number; totalLimit?: number; requireAdmin?: boolean }
export async function reserveAiRequest(user: AuthUser, cacheKey: string, options: AiBudgetOptions = {}) {
  if (!user?.id || !user.email) throw new AuthError("UNAUTHENTICATED", "Sign in to use AI assistance.", 401);
  if (options.requireAdmin !== false && !isAdmin(user)) throw new AuthError("FORBIDDEN", "A verified administrator account is required for Claude extraction.", 403);
  if (!isAiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "Claude assistance is not configured on the server.", 503);
  const perUserLimit = Math.max(1, Math.min(ADMIN_ATTEMPTS_PER_HOUR, Math.floor(options.perUserLimit ?? ADMIN_ATTEMPTS_PER_HOUR)));
  const totalLimit = Math.max(1, Math.min(TOTAL_ATTEMPTS_PER_HOUR, Math.floor(options.totalLimit ?? TOTAL_ATTEMPTS_PER_HOUR)));
  const operation = cacheKey.startsWith("chat:") ? "chat" : "extraction";
  const sql = getDatabase();
  let reservation: Record<string, unknown>[];
  try {
    const transaction = await sql.transaction([
      sql.query("SELECT pg_advisory_xact_lock($1)", [GLOBAL_BUDGET_LOCK]),
      sql.query(`INSERT INTO lexrent_ai_requests (user_id, cache_key)
        SELECT $1, $2
        WHERE (SELECT count(*) FROM lexrent_ai_requests WHERE user_id = $1 AND created_at >= now() - interval '1 hour'
          AND (($5 = 'chat' AND cache_key LIKE 'chat:%') OR ($5 = 'extraction' AND cache_key NOT LIKE 'chat:%'))) < $3
          AND (SELECT count(*) FROM lexrent_ai_requests WHERE created_at >= now() - interval '1 hour') < $4
        RETURNING id`, [user.id, cacheKey, perUserLimit, totalLimit, operation]),
    ]);
    reservation = transaction[1] as Record<string, unknown>[];
  } catch {
    throw new AiError("AI_PERSISTENCE_UNAVAILABLE", "The AI budget could not be reserved. No Claude request was sent.", 503);
  }
  if (!Array.isArray(reservation) || !reservation.length) throw new AiError("AI_RATE_LIMIT", `The hourly AI budget has been reached (${perUserLimit} attempts per account or ${totalLimit} total). Retry later.`, 429);
}

/** Only drafts and budget attempts are persisted here; this never publishes rules. */
export async function extractWithPersistence(source: SourceDocument, chunk: number, user: AuthUser): Promise<ExtractionResult> {
  if (!user?.id || !isAdmin(user)) throw new AuthError("FORBIDDEN", "A verified administrator account is required for Claude extraction.", 403);
  if (!isAiConfigured()) throw new AiError("AI_NOT_CONFIGURED", "Add ANTHROPIC_API_KEY on the server to enable Claude extraction.", 503);
  const identity = getExtractionIdentity(source, chunk);
  const sql = getDatabase();
  try {
    const rows = await sql.query("SELECT result_json FROM lexrent_ai_drafts WHERE cache_key = $1 AND source_hash = $2 AND doc_id = $3", [identity.cache_key, identity.source_hash, source.doc_id]) as Record<string, unknown>[];
    if (rows[0]?.result_json) {
      const cached = rows[0].result_json as ExtractionResult;
      const validation = validateRuleBundle(cached.bundle, [source]);
      if (!validation.valid || !validation.bundle || cached.doc_id !== source.doc_id || cached.chunk !== chunk || cached.source_sha256 !== identity.source_hash || cached.model !== identity.model || cached.prompt_version !== identity.prompt_version || cached.requires_review !== true) throw new AiError("AI_CACHE_INVALID", "The saved draft no longer passes source validation; an administrator must review the cached record.", 503);
      return { ...cached, bundle: validation.bundle, cache_hit: true };
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("AI_PERSISTENCE_UNAVAILABLE", "Draft storage is unavailable. Check the database configuration and apply the AI draft migration before extraction.", 503);
  }
  // A committed reservation serializes global count-and-insert before Claude.
  await reserveAiRequest(user, identity.cache_key);
  // The reservation is committed before calling Claude. Provider, validation and
  // persistence failures count as attempts; nothing deletes or refunds this row.
  const result = await extractSourceChunk(source, chunk);
  try {
    await sql.query(`INSERT INTO lexrent_ai_drafts (cache_key, source_hash, doc_id, result_json)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (cache_key) DO NOTHING`, [identity.cache_key, identity.source_hash, source.doc_id, JSON.stringify(result)]);
  } catch {
    throw new AiError("AI_PERSISTENCE_UNAVAILABLE", "Claude produced a draft, but saving it could not be confirmed. No rules were published; retry to recover the draft.", 503);
  }
  return result;
}
