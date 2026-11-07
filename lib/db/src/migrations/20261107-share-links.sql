CREATE TABLE IF NOT EXISTS echo_share_links (
  token_hash text PRIMARY KEY,
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('universe', 'character')),
  character_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (owner_id, universe_id) REFERENCES echo_universes(owner_id, universe_id) ON DELETE CASCADE
);
