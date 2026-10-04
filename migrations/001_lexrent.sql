CREATE TABLE IF NOT EXISTS lexrent_rule_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source_file text,
  sha256 text NOT NULL UNIQUE,
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'array'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lexrent_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  name text,
  as_of date NOT NULL,
  rule_bundle_id uuid REFERENCES lexrent_rule_bundles(id),
  input_snapshot jsonb NOT NULL,
  results jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lexrent_evaluation_runs_owner_created_idx
  ON lexrent_evaluation_runs(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lexrent_saved_properties (
  owner_user_id text NOT NULL,
  address_id text NOT NULL,
  label text,
  collection_name text NOT NULL DEFAULT 'Saved properties',
  property_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, address_id)
);

CREATE INDEX IF NOT EXISTS lexrent_saved_properties_owner_updated_idx
  ON lexrent_saved_properties(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS lexrent_audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lexrent_audit_records_created_idx
  ON lexrent_audit_records(created_at DESC);

CREATE TABLE IF NOT EXISTS lexrent_jurisdiction_resolutions (
  address_id text PRIMARY KEY,
  resolution jsonb NOT NULL,
  verified_by_user_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lexrent_source_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id text NOT NULL,
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  sha256 text NOT NULL,
  source_text text NOT NULL,
  verified_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, sha256)
);

CREATE INDEX IF NOT EXISTS lexrent_source_captures_doc_created_idx
  ON lexrent_source_captures(doc_id, created_at DESC);
