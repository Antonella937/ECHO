CREATE TABLE IF NOT EXISTS echo_character_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  media_ref text NOT NULL,
  reusable boolean NOT NULL DEFAULT false,
  reserved boolean NOT NULL DEFAULT false,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_character_gallery_owner_idx ON echo_character_gallery (owner_id, universe_id, character_id);
