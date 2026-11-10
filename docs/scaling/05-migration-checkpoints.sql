-- ECHO partition migration: resumable per-universe checkpoints.
-- ADDITIVE PROPOSAL ONLY. Not executed against production.
-- Apply through the repository's reviewed migration mechanism after backup.
CREATE TABLE IF NOT EXISTS echo_social_migration_checkpoints (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 0),
  characters_count integer NOT NULL CHECK (characters_count >= 0),
  posts_count integer NOT NULL CHECK (posts_count >= 0),
  messages_count integer NOT NULL CHECK (messages_count >= 0),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id)
);
-- Checkpoint only AFTER an atomic backfill + exact parity verification.
-- The worker must compare echo_universes.revision with source_revision
-- immediately before recording a checkpoint, in the SAME transaction.
-- Any subsequent legacy JSON write invalidates that checkpoint for read cutover.
-- A valid checkpoint does NOT mean comments, stories, follows, notifications
-- or memories have migrated; retain legacy source of truth for those entities.
-- Never auto-enable partitioned writes based only on this table.
