CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS lexrent_vector_corpora (
  fingerprint text PRIMARY KEY,
  model_id text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions = 128),
  input_chunk_count integer NOT NULL CHECK (input_chunk_count >= 0),
  indexed_chunk_count integer NOT NULL CHECK (indexed_chunk_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lexrent_vector_chunks (
  corpus_fingerprint text NOT NULL REFERENCES lexrent_vector_corpora(fingerprint),
  chunk_id text NOT NULL,
  doc_id text NOT NULL,
  source_sha256 text NOT NULL,
  source_url text NOT NULL,
  source_state text NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  text text NOT NULL,
  context text NOT NULL,
  text_sha256 text NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  embedding vector(128) NOT NULL,
  PRIMARY KEY (corpus_fingerprint, chunk_id)
);

CREATE INDEX IF NOT EXISTS lexrent_vector_chunks_source_idx
  ON lexrent_vector_chunks (corpus_fingerprint, source_state, doc_id, source_sha256);
