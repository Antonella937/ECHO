-- Apply with the ECHO database migration process before enabling scene group sends.
-- Every outgoing event is reserved once. An uncertain network result MUST NOT be
-- automatically retried: Kindroid may have accepted it already.
CREATE TABLE IF NOT EXISTS echo_scene_kindroid_deliveries (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  scene_id text NOT NULL,
  event_id text NOT NULL,
  kindroid_group_id text NOT NULL,
  delivery_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT echo_scene_kindroid_deliveries_pk
    PRIMARY KEY (owner_id, universe_id, scene_id, event_id),
  CONSTRAINT echo_scene_kindroid_deliveries_key_unique
    UNIQUE (delivery_key),
  CONSTRAINT echo_scene_kindroid_deliveries_status_check
    CHECK (status IN ('reserved', 'sending', 'sent', 'uncertain', 'failed')),
  CONSTRAINT echo_scene_kindroid_deliveries_group_check
    CHECK (kindroid_group_id ~ '^[A-Za-z0-9_-]{8,160}$')
);
CREATE INDEX IF NOT EXISTS echo_scene_kindroid_deliveries_pending_idx
  ON echo_scene_kindroid_deliveries (owner_id, universe_id, scene_id, status);
