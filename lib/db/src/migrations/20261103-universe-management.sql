-- Additive migration only: existing universes stay available, content is unchanged.
ALTER TABLE echo_universes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE echo_universes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
