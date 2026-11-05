-- Apply to the ECHO Postgres database before enabling archive writes.
CREATE TABLE IF NOT EXISTS echo_memory_archive (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  memory_id text NOT NULL,
  source_id text,
  kind text NOT NULL,
  target_id text,
  content text NOT NULL,
  occurred_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, character_id, memory_id)
);
CREATE INDEX IF NOT EXISTS echo_memory_archive_scope_time_idx
  ON echo_memory_archive (owner_id, universe_id, character_id, occurred_at);
