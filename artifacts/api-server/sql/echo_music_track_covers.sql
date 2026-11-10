-- Add independent, private cover artwork to each saved ECHO Music track.
-- Already applied to ECHO Neon; safe to re-run.
ALTER TABLE echo_music_library ADD COLUMN IF NOT EXISTS cover_path text;
