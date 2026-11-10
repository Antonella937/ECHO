-- ECHO scalability phase 1: additive, non-destructive schema proposal.
-- NOT applied automatically. Existing echo_universes remains the source of truth.
-- All reads/writes MUST scope owner_id + universe_id; never query by character_id alone.
-- Run only after validating backups and migration strategy.
CREATE TABLE IF NOT EXISTS echo_character_records (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, character_id)
);
CREATE TABLE IF NOT EXISTS echo_post_records (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  post_id text NOT NULL,
  author_id text NOT NULL,
  published_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (owner_id, universe_id, post_id)
);
CREATE INDEX IF NOT EXISTS echo_post_records_feed_idx
  ON echo_post_records (owner_id, universe_id, published_at DESC, post_id);
CREATE INDEX IF NOT EXISTS echo_post_records_author_idx
  ON echo_post_records (owner_id, universe_id, author_id, published_at DESC, post_id);
CREATE TABLE IF NOT EXISTS echo_message_records (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  message_id text NOT NULL,
  thread_id text NOT NULL,
  sent_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (owner_id, universe_id, message_id)
);
CREATE INDEX IF NOT EXISTS echo_message_records_thread_idx
  ON echo_message_records (owner_id, universe_id, thread_id, sent_at DESC, message_id);
-- Next: migration with per-universe revision checkpoint, dual-read comparison,
-- and idempotent backfill. Do not enable independent writes before parity checks.
