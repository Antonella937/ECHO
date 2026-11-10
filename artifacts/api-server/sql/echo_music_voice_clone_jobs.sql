-- ECHO Music: durable voice-clone jobs. Apply through the existing Neon migration process
-- before enabling any billable cloning. No provider calls occur in this migration.
CREATE TABLE IF NOT EXISTS echo_music_voice_clone_jobs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  character_id text NOT NULL,
  sample_storage_key text NOT NULL,
  sample_duration_seconds numeric(5,2) NOT NULL CHECK (sample_duration_seconds BETWEEN 15 AND 30),
  estimated_cost_usd numeric(8,2) NOT NULL DEFAULT 5.00,
  consent_confirmed boolean NOT NULL DEFAULT false,
  charge_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status IN ('awaiting_confirmation','submitting','processing','completed','failed','submission_uncertain')),
  provider_request_id text,
  provider_vocal_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT echo_music_clone_confirmed_before_submit CHECK (
    status = 'awaiting_confirmation' OR (consent_confirmed AND charge_confirmed)
  )
);
CREATE INDEX IF NOT EXISTS echo_music_voice_clone_owner_idx
  ON echo_music_voice_clone_jobs (owner_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS echo_music_voice_clone_request_unique
  ON echo_music_voice_clone_jobs (provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS echo_music_voice_clone_active_character_unique
  ON echo_music_voice_clone_jobs (owner_id,character_id)
  WHERE status IN ('awaiting_confirmation','submitting','processing','submission_uncertain');
