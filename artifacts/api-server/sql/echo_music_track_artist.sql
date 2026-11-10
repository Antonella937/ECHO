-- Per-song display credit, independent from account ownership or source character.
-- Applied to ECHO Neon; safe to run again.
ALTER TABLE echo_music_library ADD COLUMN IF NOT EXISTS artist_name text;
