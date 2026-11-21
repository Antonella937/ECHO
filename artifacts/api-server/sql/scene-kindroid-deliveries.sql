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

-- Serialize outbound writes per owner and Kindroid group across concurrent requests.
-- A second in-flight message cannot enter 'sending' until the first has settled.
CREATE UNIQUE INDEX IF NOT EXISTS echo_scene_kindroid_one_sending_per_group
  ON echo_scene_kindroid_deliveries (owner_id, kindroid_group_id)
  WHERE status = 'sending';

-- Kin replies are remote writes too: reserve before generating, and do not
-- retry a timeout without reconciling the Kindroid group history.
CREATE TABLE IF NOT EXISTS echo_scene_kindroid_generations (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  scene_id text NOT NULL,
  source_event_id text NOT NULL,
  character_id text NOT NULL,
  kin_id text NOT NULL,
  kindroid_group_id text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT echo_scene_kindroid_generations_pk PRIMARY KEY
    (owner_id,universe_id,scene_id,source_event_id,character_id),
  CONSTRAINT echo_scene_kindroid_generations_status_check
    CHECK (status IN ('reserved','generating','generated','uncertain'))
);
CREATE UNIQUE INDEX IF NOT EXISTS echo_scene_kindroid_one_generation_per_group
  ON echo_scene_kindroid_generations (owner_id,kindroid_group_id)
  WHERE status = 'generating';

-- A shared per-group lease serializes both human messages and Kin generations.
-- The per-operation partial indexes above remain defense in depth.
CREATE TABLE IF NOT EXISTS echo_scene_kindroid_group_leases (
  owner_id text NOT NULL,
  kindroid_group_id text NOT NULL,
  operation_kind text NOT NULL,
  scene_id text NOT NULL,
  operation_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT echo_scene_kindroid_group_leases_pk
    PRIMARY KEY (owner_id,kindroid_group_id),
  CONSTRAINT echo_scene_kindroid_group_leases_kind_check
    CHECK (operation_kind IN ('send','generate')),
  CONSTRAINT echo_scene_kindroid_group_leases_status_check
    CHECK (status IN ('active','uncertain','resolved'))
);
-- A lease in 'uncertain' state must be manually reconciled, never timed out
-- and silently reused. Do not delete these rows as routine cleanup.
