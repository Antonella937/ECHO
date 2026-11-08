CREATE TABLE IF NOT EXISTS echo_scheduled_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, universe_id text NOT NULL,
 character_id text NOT NULL, gallery_photo_id uuid NOT NULL, caption text NOT NULL,
 scheduled_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending',
 post_id text, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS echo_scheduled_posts_due_idx ON echo_scheduled_posts (scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS echo_scheduled_posts_owner_idx ON echo_scheduled_posts (owner_id, universe_id, character_id);