import type { SourceDocument, RetrievalChunk } from "./types";
export function sourceWhitespaceMap(text: string) {
  const characters: string[] = [], starts: number[] = [], ends: number[] = [];
  for (let index = 0; index < text.length;) {
    const start = index;
    if (/\s/.test(text[index])) {
      while (index < text.length && /\s/.test(text[index])) index++;
      if (characters.length && index < text.length) { characters.push(" "); starts.push(start); ends.push(index); }
    } else { characters.push(text[index]); starts.push(index); ends.push(++index); }
  }
  return { text: characters.join(""), starts, ends };
}
export function validateKnowledgeBaseChunks(records: Record<string, unknown>[], sources: readonly SourceDocument[]) {
  const sourceIndex = new Map(sources.map(source => [source.doc_id, source]));
  const maps = new Map<string, ReturnType<typeof sourceWhitespaceMap>>();
  const chunks: RetrievalChunk[] = [];
  const lawChunks = records.filter(record => record.type === "law_chunk");
  for (const record of lawChunks) {
    const source = sourceIndex.get(String(record.doc_id));
    if (!source?.captured || !source.text || source.url !== record.url || source.sha256 !== record.sha256 || typeof record.text !== "string") continue;
    let map = maps.get(source.doc_id);
    if (!map) { map = sourceWhitespaceMap(source.text); maps.set(source.doc_id, map); }
    const normalized = record.text.replace(/\s+/g, " ").trim();
    const offset = map.text.indexOf(normalized);
    if (!normalized || offset < 0) continue;
    const start_offset = map.starts[offset], end_offset = map.ends[offset + normalized.length - 1];
    chunks.push({ id: String(record.id), doc_id: source.doc_id, chunk_index: Number(record.chunk_index), text: source.text.slice(start_offset, end_offset), context: `${source.jurisdictions} | ${source.source_type} | ${source.url} | retrieved ${source.retrieved_at}`, source_sha256: source.sha256, start_offset, end_offset });
  }
  return { chunks, audit: { provided_records: records.length, law_chunks: lawChunks.length, validated_chunks: chunks.length, rejected_chunks: lawChunks.length - chunks.length } };
}
