-- Private, owner-scoped manual comparison between speaking and singing references.
-- This is an auditory assessment, not biometric voice verification.
CREATE TABLE IF NOT EXISTS echo_music_voice_comparisons (
  owner_id text NOT NULL,
  universe_id text NOT NULL,
  character_id text NOT NULL,
  singing_track_id uuid NOT NULL,
  speech_sample_id uuid,
  assessment text NOT NULL CHECK (assessment IN ('similar','different')),
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, universe_id, character_id)
);
CREATE INDEX IF NOT EXISTS echo_music_voice_comparisons_owner_idx ON echo_music_voice_comparisons(owner_id, universe_id);
