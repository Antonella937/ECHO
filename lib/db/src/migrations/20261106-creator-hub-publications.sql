CREATE TABLE IF NOT EXISTS echo_creator_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES echo_creator_profiles(owner_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('character','world','update','post')),
  title varchar(120) NOT NULL,
  body text NOT NULL DEFAULT '',
  cover_path text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','followers','private')),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT echo_creator_publications_body_limit CHECK (length(body)<=5000)
);
CREATE INDEX IF NOT EXISTS echo_creator_publications_owner_idx ON echo_creator_publications(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS echo_creator_publications_public_idx ON echo_creator_publications(created_at DESC) WHERE visibility='public';
