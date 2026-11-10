-- Vocal isolation is a separate paid operation from voice cloning.
CREATE TABLE IF NOT EXISTS echo_music_vocal_separation_jobs (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL,
 character_id text NOT NULL,
 sample_storage_key text NOT NULL,
 duration_seconds numeric(5,2) NOT NULL CHECK(duration_seconds BETWEEN 15 AND 30),
 status text NOT NULL DEFAULT 'awaiting_confirmation'
   CHECK(status IN ('awaiting_confirmation','submitting','processing','completed','submission_uncertain','failed')),
 provider_request_id text,
 isolated_storage_key text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CONSTRAINT echo_music_vocal_sep_owner_unique UNIQUE(id,owner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS echo_music_vocal_sep_active_idx
 ON echo_music_vocal_separation_jobs(owner_id,character_id)
 WHERE status IN ('awaiting_confirmation','submitting','processing','submission_uncertain');
