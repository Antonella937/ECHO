-- ECHO GIF conversion metadata. Dormant until verified conversion pipeline is enabled.
-- Apply after 20261110-video-credits-preparation.sql.
CREATE TABLE IF NOT EXISTS echo_video_gif_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  source_video_job_id uuid NOT NULL REFERENCES echo_video_generation_jobs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','succeeded','failed')),
  start_seconds numeric(5,2) NOT NULL DEFAULT 0 CHECK (start_seconds >= 0 AND start_seconds <= 10),
  duration_seconds numeric(5,2) NOT NULL CHECK (duration_seconds >= 1 AND duration_seconds <= 10),
  width integer NOT NULL CHECK (width IN (320,480,640)),
  fps integer NOT NULL CHECK (fps IN (10,12,15)),
  result_asset_key text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_seconds + duration_seconds <= 10),
  CHECK (status <> 'succeeded' OR result_asset_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS echo_video_gif_jobs_owner_idx
  ON echo_video_gif_jobs(owner_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS echo_video_gif_one_active_per_owner
  ON echo_video_gif_jobs(owner_id) WHERE status IN ('pending','processing');
-- Important: enforce source job ownership in the application transaction.
-- No GIF jobs are inserted by the dormant endpoints.
