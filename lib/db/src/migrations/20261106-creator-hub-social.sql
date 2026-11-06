-- Creator Hub: real account profiles and account-to-account follow requests.
-- All accounts are private unless their owner explicitly opts into public visibility.
-- Do not infer sharing of universes or characters from an account follow.
CREATE TABLE IF NOT EXISTS echo_creator_profiles (
  owner_id text PRIMARY KEY,
  display_name text NOT NULL,
  display_name_key text NOT NULL,
  username text NOT NULL,
  username_key text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  bio text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT echo_creator_profile_display_name_length CHECK (char_length(display_name) BETWEEN 2 AND 80),
  CONSTRAINT echo_creator_profile_username_format CHECK (username ~ '^[a-z0-9._]{3,30}$'),
  CONSTRAINT echo_creator_profile_display_name_key_unique UNIQUE (display_name_key),
  CONSTRAINT echo_creator_profile_username_key_unique UNIQUE (username_key)
);
CREATE TABLE IF NOT EXISTS echo_creator_follows (
  follower_owner_id text NOT NULL,
  followed_owner_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_owner_id, followed_owner_id),
  CONSTRAINT echo_creator_follows_no_self CHECK (follower_owner_id <> followed_owner_id)
);
CREATE INDEX IF NOT EXISTS echo_creator_follows_followed_idx ON echo_creator_follows (followed_owner_id);
CREATE TABLE IF NOT EXISTS echo_creator_follow_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_owner_id text NOT NULL,
  recipient_owner_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT echo_creator_follow_requests_no_self CHECK (requester_owner_id <> recipient_owner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS echo_creator_follow_requests_one_pending_idx
  ON echo_creator_follow_requests (requester_owner_id, recipient_owner_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS echo_creator_follow_requests_recipient_idx
  ON echo_creator_follow_requests (recipient_owner_id, status);
-- Account-level DM storage is deliberately NOT added here: it requires a
-- separate authenticated, recipient-scoped messaging API and consent policy.
