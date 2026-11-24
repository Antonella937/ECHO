ALTER TABLE echo_character_gallery
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'both'
  CHECK (placement IN ('both', 'feed', 'story'));
