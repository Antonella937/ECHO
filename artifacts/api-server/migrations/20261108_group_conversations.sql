-- Additive ECHO group DM storage (applied to Neon on 2026-11-08).
-- Group conversations are stored independently from legacy one-to-one messages.
CREATE TABLE IF NOT EXISTS echo_group_conversations (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  id text NOT NULL,
  name varchar(80) NOT NULL,
  avatar text,
  created_by text NOT NULL,
  participant_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, id),
  CONSTRAINT echo_group_participants_array CHECK (jsonb_typeof(participant_ids) = 'array')
);

CREATE TABLE IF NOT EXISTS echo_group_messages (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  id text NOT NULL,
  group_id text NOT NULL,
  sender_id text NOT NULL,
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  quote_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, id),
  FOREIGN KEY (owner_id, universe_id, group_id)
    REFERENCES echo_group_conversations(owner_id, universe_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS echo_group_messages_thread_idx
  ON echo_group_messages (owner_id, universe_id, group_id, created_at);
