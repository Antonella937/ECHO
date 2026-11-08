-- Apply through the project's normal database migration process before enabling the API.
-- Each owner's settings are isolated by owner, universe and character.
CREATE TABLE IF NOT EXISTS echo_dm_conversation_preferences (
  owner_id text NOT NULL,
  universe_id text NOT NULL DEFAULT 'primary',
  character_id text NOT NULL,
  preferences jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, character_id),
  CONSTRAINT echo_dm_conversation_preferences_object CHECK (jsonb_typeof(preferences) = 'object')
);
