import { Buffer } from "node:buffer";
import model from "../data/vector-model.json";
import type { RetrievalChunk } from "./types";

/** This fitted model is server-only; intentionally absent from the domain barrel. */
export const VECTOR_DIMENSIONS = 128;
export const vectorModelInfo = Object.freeze({
  model_id: model.model_id, dimensions: VECTOR_DIMENSIONS,
  vocabulary_size: model.vocabulary_size, document_count: model.document_count,
});
export interface VectorEmbeddingResult { embedding: number[]; known_terms: number; model_id: string }
const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with shall may any such not no than then there these those their they which who whom".split(" "));
let projection: Float32Array | undefined;
let vocabulary: Map<string, number> | undefined;

function fittedModel() {
  if (projection && vocabulary) return { projection, vocabulary };
  if (model.schema_version !== 1 || model.algorithm !== "tfidf-lsa-v1" || model.dimensions !== VECTOR_DIMENSIONS || model.vocabulary.length !== model.vocabulary_size || model.idf.length !== model.vocabulary_size) throw new Error("Invalid fitted vector model.");
  const bytes = Buffer.from(model.components_float16_base64, "base64");
  if (bytes.length !== model.vocabulary_size * VECTOR_DIMENSIONS * 2) throw new Error("Invalid fitted projection length.");
  projection = new Float32Array(model.vocabulary_size * VECTOR_DIMENSIONS);
  for (let index = 0; index < projection.length; index++) {
    const bits = bytes.readUInt16LE(index * 2), exponent = (bits >>> 10) & 31, fraction = bits & 1023;
    const sign = bits & 0x8000 ? -1 : 1;
    if (exponent === 31) throw new Error("Non-finite fitted projection.");
    projection[index] = sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
  }
  vocabulary = new Map(model.vocabulary.map((term, index) => [term, index]));
  if (vocabulary.size !== model.vocabulary_size || model.idf.some(value => !Number.isFinite(value) || value <= 0)) throw new Error("Invalid fitted vocabulary weights.");
  return { projection, vocabulary };
}

/** Mirrors the supplied Python tokenizer: ASCII words, stop removal, then bigrams. */
export function vectorTokens(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => !STOP.has(word));
  return [...words, ...words.slice(0, -1).map((word, index) => word + " " + words[index + 1])];
}

/** Same fixed TF-IDF and truncated-SVD projection as kb_search.py; no API charge. */
export function embedVectorText(text: string): VectorEmbeddingResult | null {
  const fitted = fittedModel(), counts = new Map<number, number>();
  for (const term of vectorTokens(text)) {
    const index = fitted.vocabulary.get(term);
    if (index !== undefined) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const weighted = [...counts].map(([index, count]) => ({ index, weight: (1 + Math.log(count)) * model.idf[index] }));
  const sparseNorm = Math.hypot(...weighted.map(term => term.weight));
  const embedding = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  for (const { index, weight } of weighted) {
    const normalizedWeight = weight / sparseNorm, start = index * VECTOR_DIMENSIONS;
    for (let dimension = 0; dimension < VECTOR_DIMENSIONS; dimension++) embedding[dimension] += normalizedWeight * fitted.projection[start + dimension];
  }
  const denseNorm = Math.hypot(...embedding);
  if (!Number.isFinite(denseNorm) || denseNorm <= 1e-9) return null;
  for (let dimension = 0; dimension < VECTOR_DIMENSIONS; dimension++) embedding[dimension] /= denseNorm;
  return { embedding, known_terms: counts.size, model_id: vectorModelInfo.model_id };
}

/** Context expansion used when fitting the supplied 601-record index. */
export function vectorDocumentText(chunk: Pick<RetrievalChunk, "context" | "text">): string {
  const jurisdiction = chunk.context.split(" | ")[0];
  const state = jurisdiction.split(",").at(-1)?.trim();
  const fullState = ({ CA: "California", NJ: "New Jersey", MA: "Massachusetts" } as Record<string, string>)[state ?? ""] ?? "";
  return chunk.context + " | " + fullState + "\n" + chunk.text;
}
