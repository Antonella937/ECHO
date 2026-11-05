-- Apply to Neon before enabling the approved progression write path.
-- Never run on production automatically as part of a preview.
CREATE TABLE IF NOT EXISTS echo_relationship_ledger (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  actor_id text NOT NULL,
  target_id text NOT NULL,
  last_applied_at timestamptz NOT NULL,
  applied_count integer NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  consumed_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (owner_id, universe_id, actor_id, target_id)
);
CREATE INDEX IF NOT EXISTS echo_relationship_ledger_scope_idx
  ON echo_relationship_ledger (owner_id, universe_id, actor_id);
