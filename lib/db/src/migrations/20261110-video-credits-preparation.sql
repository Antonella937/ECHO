-- ECHO Video/GIF: dormant prepaid credit infrastructure. No purchase or generation is enabled.
-- Provider activation and Paddle webhook verification must precede any credit grant.
CREATE TABLE IF NOT EXISTS echo_video_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN ('purchase', 'generation', 'refund', 'adjustment')),
  idempotency_key text NOT NULL UNIQUE,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_video_credit_ledger_owner_idx ON echo_video_credit_ledger(owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS echo_video_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  mode text NOT NULL CHECK (mode IN ('standard', 'advanced_silent', 'advanced_audio')),
  duration_seconds integer NOT NULL CHECK (duration_seconds IN (5,10)),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 6),
  provider_job_id text,
  result_asset_key text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_video_generation_jobs_owner_idx ON echo_video_generation_jobs(owner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS echo_video_one_active_job_per_owner ON echo_video_generation_jobs(owner_id) WHERE status IN ('pending', 'processing');
