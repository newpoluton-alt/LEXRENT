CREATE TABLE IF NOT EXISTS lexrent_ai_drafts (
  cache_key text PRIMARY KEY,
  source_hash text NOT NULL,
  doc_id text NOT NULL,
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lexrent_ai_drafts_doc_created_idx
  ON lexrent_ai_drafts(doc_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lexrent_ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  cache_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lexrent_ai_requests_created_idx
  ON lexrent_ai_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS lexrent_ai_requests_user_created_idx
  ON lexrent_ai_requests(user_id, created_at DESC);
