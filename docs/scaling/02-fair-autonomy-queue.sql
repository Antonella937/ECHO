-- ECHO scalable autonomy: durable queue foundation (NOT deployed).
-- This is additive infrastructure; existing autonomy runtime is unchanged.
-- Jobs are isolated by owner and universe. Workers must authenticate as trusted
-- internal services, not expose this table directly to clients.
CREATE TABLE IF NOT EXISTS echo_autonomy_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  job_kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','leased','done','failed','cancelled')),
  priority smallint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  run_after timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  lease_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS echo_autonomy_jobs_dedupe_idx
  ON echo_autonomy_jobs (owner_id, universe_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','leased');
CREATE INDEX IF NOT EXISTS echo_autonomy_jobs_ready_idx
  ON echo_autonomy_jobs (priority DESC, run_after ASC, created_at ASC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS echo_autonomy_jobs_owner_idx
  ON echo_autonomy_jobs (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS echo_autonomy_jobs_expired_idx
  ON echo_autonomy_jobs (leased_until)
  WHERE status = 'leased';

-- Enqueue using a stable dedupe_key for an action/event. Workers must:
-- 1. Requeue expired leases with bounded retries.
-- 2. Enforce per-owner and global concurrency limits BEFORE claiming work.
-- 3. Claim jobs atomically using SELECT ... FOR UPDATE SKIP LOCKED,
--    with a lease_token and leased_until.
-- 4. Require matching lease_token when acknowledging or retrying a job.
-- 5. Revalidate character permissions and current universe revision before action.
-- 6. Make resulting social writes idempotent by event ID.
-- 7. Use fair owner scheduling; priority alone is not fair.
-- 8. Bound payload size, queue depth per owner and execution time.
-- Do not turn on workers until these guarantees and monitoring are implemented.
