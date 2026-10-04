import { loadEnvFile } from "node:process";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { sources as starterSources } from "../src/domain";
import { getCurrentKnowledgeChunks } from "../src/server/chat";
import { syncVectorCorpus } from "../src/server/vector-store";

async function index() {
  for (const filename of [".env.local", ".env"]) {
    try { loadEnvFile(path.join(process.cwd(), filename)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required.");
  const sql = neon(process.env.DATABASE_URL.trim());
  const captures = await sql.query("SELECT DISTINCT ON (doc_id) doc_id, source_url, source_text AS text, sha256 AS hash, retrieved_at FROM lexrent_source_captures ORDER BY doc_id, created_at DESC, id DESC");
  const sources = starterSources.map(source => {
    const captured = captures.find(row => row.doc_id === source.doc_id && row.source_url === source.url);
    return captured ? { ...source, captured: true, text: String(captured.text), sha256: String(captured.hash), retrieved_at: new Date(captured.retrieved_at as string).toISOString(), status: "captured" } : source;
  });
  const result = await syncVectorCorpus(getCurrentKnowledgeChunks({ sources }), sources);
  console.info(JSON.stringify({ model: result.model, dimensions: result.dimensions, validated_chunks: result.input_chunk_count, indexed_chunks: result.indexed_chunk_count, fingerprint: result.fingerprint }));
}
index().catch(() => { console.error("Vector indexing failed. Check DATABASE_URL, migration 003, and the bundled projection model."); process.exitCode = 1; });
