import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { resolve } from "node:path";

// Read only the small numeric/string NPY subset supplied by numpy.savez.
// No Python, pickle, eval, object arrays, or executable file imports are used.
const archive = readFileSync(resolve(process.cwd(), "AI RAG/kb_index.npz"));
const MAX_ARRAY_BYTES = 32_000_000;
function npzArray(name: string) {
  let end = archive.length - 22;
  while (end >= Math.max(0, archive.length - 65_557) && archive.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, archive.length - 65_557)) throw new Error("Invalid NPZ central directory.");
  if (archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6)) throw new Error("Multi-disk NPZ is unsupported.");
  let cursor = archive.readUInt32LE(end + 16);
  const count = archive.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid NPZ directory entry.");
    const flags = archive.readUInt16LE(cursor + 8), method = archive.readUInt16LE(cursor + 10);
    const compressed = archive.readUInt32LE(cursor + 20), uncompressed = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28), extraLength = archive.readUInt16LE(cursor + 30), commentLength = archive.readUInt16LE(cursor + 32);
    const fileName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (fileName === name) {
      if (flags & 1 || uncompressed > MAX_ARRAY_BYTES || compressed > archive.length) throw new Error("Encrypted or oversized NPZ array.");
      const local = archive.readUInt32LE(cursor + 42);
      if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid NPZ local entry.");
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      if (start + compressed > archive.length) throw new Error("Truncated NPZ array.");
      const packed = archive.subarray(start, start + compressed);
      const data = method === 8 ? inflateRawSync(packed, { maxOutputLength: MAX_ARRAY_BYTES }) : method === 0 ? packed : null;
      if (!data || data.length !== uncompressed) throw new Error("Unsupported or corrupt NPZ compression.");
      if (data.subarray(0, 6).toString("latin1") !== "\x93NUMPY") throw new Error("Invalid NPY header.");
      const version = data[6], headerLength = version === 1 ? data.readUInt16LE(8) : version === 2 || version === 3 ? data.readUInt32LE(8) : -1;
      if (headerLength < 0) throw new Error("Unsupported NPY version.");
      const headerStart = version === 1 ? 10 : 12, payloadStart = headerStart + headerLength;
      const header = data.subarray(headerStart, payloadStart).toString("utf8");
      const dtype = /'descr':\s*'([^']+)'/.exec(header)?.[1];
      const shapeText = /'shape':\s*\(([\d,\s]*)\)/.exec(header)?.[1];
      if (!dtype || shapeText === undefined || !/'fortran_order':\s*False/.test(header)) throw new Error("Unsupported NPY layout.");
      const shape = shapeText.split(",").filter(value => value.trim()).map(Number);
      const entries = shape.reduce((product, value) => product * value, 1);
      if (shape.some(value => !Number.isSafeInteger(value) || value < 0) || !Number.isSafeInteger(entries)) throw new Error("Invalid NPY shape.");
      return { dtype, shape, entries, payload: data.subarray(payloadStart) };
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("Missing " + name + " in supplied NPZ.");
}
const vocabArray = npzArray("vocab.npy"), idfArray = npzArray("idf.npy"), components = npzArray("comp_t.npy");
const docs = npzArray("n_docs.npy"), dim = npzArray("dim.npy");
const unicodeWidth = Number(/^<U(\d+)$/.exec(vocabArray.dtype)?.[1]);
if (!unicodeWidth || vocabArray.shape.length !== 1 || vocabArray.payload.length !== vocabArray.entries * unicodeWidth * 4) throw new Error("Invalid fitted vocabulary.");
const vocabulary = Array.from({ length: vocabArray.entries }, (_, index) => {
  const characters: number[] = [];
  for (let offset = 0; offset < unicodeWidth; offset++) {
    const codepoint = vocabArray.payload.readUInt32LE((index * unicodeWidth + offset) * 4);
    if (!codepoint) break;
    if (codepoint > 0x10ffff) throw new Error("Invalid fitted vocabulary codepoint.");
    characters.push(codepoint);
  }
  return String.fromCodePoint(...characters);
});
if (idfArray.dtype !== "<f4" || idfArray.shape.length !== 1 || idfArray.entries !== vocabulary.length || idfArray.payload.length !== vocabulary.length * 4) throw new Error("Invalid fitted IDF.");
const idf = Array.from({ length: vocabulary.length }, (_, index) => idfArray.payload.readFloatLE(index * 4));
if (idf.some(value => !Number.isFinite(value) || value <= 0)) throw new Error("Invalid IDF weights.");
if (dim.dtype !== "<i8" || docs.dtype !== "<i8" || dim.shape.length || docs.shape.length || dim.payload.length !== 8 || docs.payload.length !== 8) throw new Error("Invalid fitted dimensions.");
const dimensions = Number(dim.payload.readBigInt64LE()), documentCount = Number(docs.payload.readBigInt64LE());
if (dimensions !== 128 || documentCount !== 601 || components.dtype !== "<f2" || components.shape[0] !== vocabulary.length || components.shape[1] !== dimensions || components.payload.length !== vocabulary.length * dimensions * 2) throw new Error("Unexpected fitted projection shape.");
for (let offset = 0; offset < components.payload.length; offset += 2) if ((components.payload.readUInt16LE(offset) & 0x7c00) === 0x7c00) throw new Error("Non-finite fitted projection.");
const sourceHash = createHash("sha256").update(archive).digest("hex");
const model = {
  schema_version: 1, algorithm: "tfidf-lsa-v1", model_id: "tfidf-lsa-v1:" + sourceHash,
  source_sha256: sourceHash, dimensions, vocabulary_size: vocabulary.length, document_count: documentCount,
  vocabulary, idf, components_float16_base64: components.payload.toString("base64"),
};
writeFileSync(resolve(process.cwd(), "src/data/vector-model.json"), JSON.stringify(model) + "\n");
console.log("Exported fitted LSA model: " + vocabulary.length + " terms, " + dimensions + " dimensions, " + documentCount + " fit records.");
