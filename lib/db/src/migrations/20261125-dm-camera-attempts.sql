CREATE TABLE IF NOT EXISTS echo_dm_camera_attempts (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, message_id)
);
CREATE INDEX IF NOT EXISTS echo_dm_camera_attempts_owner_time_idx
  ON echo_dm_camera_attempts (owner_id, created_at);
