import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { RetrievalChunk, SourceDocument } from "../domain/types";
import { embedVectorText, vectorDocumentText, vectorModelInfo } from "../domain/vector-embedding";

type Sql = NeonQueryFunction<false, false>;
export class VectorStoreError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message); this.name = "VectorStoreError";
  }
}
export interface VectorCorpusInfo { fingerprint: string; model: string; dimensions: number; input_chunk_count: number; indexed_chunk_count: number }
export interface VectorSearchResult { hits: { id: string; similarity: number }[]; status: "ready" | "not_indexed" | "unavailable" | "empty_query"; model: string; indexed_chunk_count: number }
let connection: Sql | undefined, connectionUrl: string | undefined;
const readyCorpora = new Map<string, VectorCorpusInfo>();
function database(): Sql {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new VectorStoreError("VECTOR_NOT_CONFIGURED", "Neon vector search is not configured.");
  if (!connection || connectionUrl !== url) {
    try { connection = neon(url); connectionUrl = url; readyCorpora.clear(); }
    catch { throw new VectorStoreError("VECTOR_NOT_CONFIGURED", "The vector database configuration is invalid."); }
  }
  return connection;
}
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
function currentChunks(chunks: readonly RetrievalChunk[], sources: readonly SourceDocument[]): RetrievalChunk[] {
  const bySource = new Map(sources.map(source => [source.doc_id, source]));
  const ids = new Set<string>();
  return chunks.filter(chunk => {
    const source = bySource.get(chunk.doc_id);
    const valid = source?.captured && source.text && source.sha256 === chunk.source_sha256 &&
      Number.isInteger(chunk.chunk_index) && chunk.chunk_index >= 0 && Number.isInteger(chunk.start_offset) && Number.isInteger(chunk.end_offset) &&
      chunk.start_offset >= 0 && chunk.end_offset > chunk.start_offset && chunk.end_offset <= source.text.length &&
      source.text.slice(chunk.start_offset, chunk.end_offset) === chunk.text && chunk.id && !ids.has(chunk.id);
    if (!valid) return false;
    ids.add(chunk.id); return true;
  });
}
export function vectorCorpusFingerprint(chunks: readonly RetrievalChunk[], sources: readonly SourceDocument[]): string {
  const documents = new Map(sources.map(source => [source.doc_id, source]));
  const records = currentChunks(chunks, sources).map(chunk => {
    const source = documents.get(chunk.doc_id)!;
    return [chunk.id, chunk.doc_id, chunk.chunk_index, chunk.source_sha256, source.url, source.jurisdictions, source.retrieved_at, chunk.start_offset, chunk.end_offset, hash(chunk.text), chunk.context];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return hash(JSON.stringify([vectorModelInfo.model_id, records]));
}
function checkedEmbedding(values: readonly number[]): boolean {
  return values.length === vectorModelInfo.dimensions && values.every(Number.isFinite) && values.some(value => value !== 0);
}
function remember(info: VectorCorpusInfo): VectorCorpusInfo {
  if (readyCorpora.size >= 16) readyCorpora.delete(readyCorpora.keys().next().value!);
  readyCorpora.set(info.fingerprint, info); return info;
}

/** Only source-validated public passages enter the index. One transaction exposes a complete corpus. */
export async function syncVectorCorpus(chunks: readonly RetrievalChunk[], sources: readonly SourceDocument[]): Promise<VectorCorpusInfo> {
  const sql = database(), valid = currentChunks(chunks, sources);
  const fingerprint = vectorCorpusFingerprint(valid, sources), cached = readyCorpora.get(fingerprint);
  if (cached) return cached;
  try {
    const existing = await sql.query("SELECT model_id, dimensions, input_chunk_count, indexed_chunk_count FROM lexrent_vector_corpora WHERE fingerprint = $1", [fingerprint]);
    if (existing.length && existing[0].model_id === vectorModelInfo.model_id && Number(existing[0].dimensions) === vectorModelInfo.dimensions && Number(existing[0].input_chunk_count) === valid.length) {
      return remember({ fingerprint, model: vectorModelInfo.model_id, dimensions: vectorModelInfo.dimensions, input_chunk_count: valid.length, indexed_chunk_count: Number(existing[0].indexed_chunk_count) });
    }
    const sourceMap = new Map(sources.map(source => [source.doc_id, source]));
    const rows = valid.flatMap(chunk => {
      const result = embedVectorText(vectorDocumentText(chunk));
      if (!result || result.model_id !== vectorModelInfo.model_id || !checkedEmbedding(result.embedding)) return [];
      const source = sourceMap.get(chunk.doc_id)!;
      return [{ chunk_id: chunk.id, doc_id: chunk.doc_id, source_sha256: chunk.source_sha256, source_url: source.url,
        source_state: source.jurisdictions.split(",").at(-1)!.trim(), chunk_index: chunk.chunk_index,
        text: chunk.text, context: chunk.context, text_sha256: hash(chunk.text), start_offset: chunk.start_offset, end_offset: chunk.end_offset, embedding: result.embedding }];
    });
    const statements = [
      sql.query("SELECT pg_advisory_xact_lock($1)", [197505]),
      sql.query("INSERT INTO lexrent_vector_corpora (fingerprint, model_id, dimensions, input_chunk_count, indexed_chunk_count) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (fingerprint) DO NOTHING", [fingerprint, vectorModelInfo.model_id, vectorModelInfo.dimensions, valid.length, rows.length]),
    ];
    for (let start = 0; start < rows.length; start += 50) {
      statements.push(sql.query(`INSERT INTO lexrent_vector_chunks
        (corpus_fingerprint, chunk_id, doc_id, source_sha256, source_url, source_state, chunk_index, text, context, text_sha256, start_offset, end_offset, embedding)
        SELECT $1, item.chunk_id, item.doc_id, item.source_sha256, item.source_url, item.source_state, item.chunk_index, item.text, item.context, item.text_sha256, item.start_offset, item.end_offset, item.embedding::text::vector
        FROM jsonb_to_recordset($2::jsonb) AS item(chunk_id text, doc_id text, source_sha256 text, source_url text, source_state text, chunk_index integer, text text, context text, text_sha256 text, start_offset integer, end_offset integer, embedding jsonb)
        ON CONFLICT (corpus_fingerprint, chunk_id) DO NOTHING`, [fingerprint, JSON.stringify(rows.slice(start, start + 50))]));
    }
    await sql.transaction(statements);
    return remember({ fingerprint, model: vectorModelInfo.model_id, dimensions: vectorModelInfo.dimensions, input_chunk_count: valid.length, indexed_chunk_count: rows.length });
  } catch { throw new VectorStoreError("VECTOR_UNAVAILABLE", "Vector indexing is unavailable. Check the Neon migration and database access."); }
}

/** Exact cosine search is appropriate for this small evidence corpus; no approximate recall loss. */
export async function searchVectorChunks(question: string, chunks: readonly RetrievalChunk[], sources: readonly SourceDocument[], options: { state?: string; limit?: number } = {}): Promise<VectorSearchResult> {
  const base = { hits: [] as { id: string; similarity: number }[], model: vectorModelInfo.model_id, indexed_chunk_count: 0 };
  const embedded = embedVectorText(question);
  if (!embedded || !checkedEmbedding(embedded.embedding)) return { ...base, status: "empty_query" };
  try {
    const info = await syncVectorCorpus(chunks, sources);
    if (!info.indexed_chunk_count) return { ...base, status: "not_indexed" };
    const state = ["CA", "NJ", "MA"].includes(options.state ?? "") ? options.state : null;
    const limit = Math.max(1, Math.min(64, Math.floor(options.limit ?? 32)));
    const rows = await database().query(`SELECT chunk_id, doc_id, source_sha256, source_url, text_sha256, start_offset, end_offset,
      1 - (embedding <=> $1::vector) AS similarity
      FROM lexrent_vector_chunks WHERE corpus_fingerprint = $2 AND ($3::text IS NULL OR source_state = $3)
      ORDER BY embedding <=> $1::vector, chunk_id LIMIT $4`, [JSON.stringify(embedded.embedding), info.fingerprint, state, limit]);
    const valid = new Map(currentChunks(chunks, sources).map(chunk => [chunk.id, chunk]));
    const sourceMap = new Map(sources.map(source => [source.doc_id, source]));
    const hits = rows.flatMap(row => {
      const chunk = valid.get(String(row.chunk_id)), source = chunk && sourceMap.get(chunk.doc_id);
      const similarity = Number(row.similarity);
      if (!chunk || !source || row.doc_id !== chunk.doc_id || row.source_sha256 !== source.sha256 || row.source_url !== source.url ||
        row.text_sha256 !== hash(chunk.text) || Number(row.start_offset) !== chunk.start_offset || Number(row.end_offset) !== chunk.end_offset ||
        !Number.isFinite(similarity) || similarity <= 0 || similarity > 1.00001) return [];
      return [{ id: chunk.id, similarity: Math.min(1, similarity) }];
    });
    return { hits, status: "ready", model: info.model, indexed_chunk_count: info.indexed_chunk_count };
  } catch { return { ...base, status: "unavailable" }; }
}
