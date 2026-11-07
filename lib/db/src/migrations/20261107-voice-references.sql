-- Private voice references are distinct from generated samples.
CREATE TABLE IF NOT EXISTS echo_voice_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL,
 universe_id text NOT NULL,
 character_id text NOT NULL,
 object_path text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK (content_type IN ('audio/wav','audio/mpeg','audio/mp4')),
 expected_size integer NOT NULL CHECK (expected_size BETWEEN 1 AND 20971520),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
 created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS echo_voice_references_owner_idx ON echo_voice_references(owner_id,universe_id,character_id);
