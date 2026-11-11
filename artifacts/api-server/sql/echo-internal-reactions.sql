-- Founder-only private internal character reactions; never merge into public comments.
-- Apply through the project's migration process before enabling the API.
CREATE TABLE IF NOT EXISTS echo_internal_reactions (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  surface text NOT NULL CHECK (surface IN ('post','story')),
  content_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('automatic','manual')),
  reaction_text text NOT NULL CHECK (char_length(reaction_text) BETWEEN 1 AND 2000),
  actually_viewed boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, character_id, surface, content_id)
);
CREATE INDEX IF NOT EXISTS echo_internal_reactions_owner_recent_idx
  ON echo_internal_reactions (owner_id, universe_id, generated_at DESC);
