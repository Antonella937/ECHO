-- Image generation remains disabled until this migration is applied and
-- an explicit admin-approved global ceiling is set. Default: ZERO USD.
CREATE TABLE IF NOT EXISTS echo_image_budget_months (
  month_key text PRIMARY KEY,
  ceiling_micro_usd integer NOT NULL DEFAULT 0 CHECK (ceiling_micro_usd >= 0),
  reserved_micro_usd integer NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
  spent_micro_usd integer NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT echo_image_budget_within_limit CHECK (reserved_micro_usd + spent_micro_usd <= ceiling_micro_usd)
);
CREATE TABLE IF NOT EXISTS echo_image_generation_jobs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  month_key text NOT NULL REFERENCES echo_image_budget_months(month_key),
  status text NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed', 'unknown')),
  reserved_micro_usd integer NOT NULL CHECK (reserved_micro_usd >= 0),
  reported_cost_usd numeric(14,8),
  provider text NOT NULL,
  model text NOT NULL,
  object_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS echo_image_jobs_owner_month_idx ON echo_image_generation_jobs(owner_id,month_key);
CREATE UNIQUE INDEX IF NOT EXISTS echo_image_jobs_object_path_idx ON echo_image_generation_jobs(object_path);
