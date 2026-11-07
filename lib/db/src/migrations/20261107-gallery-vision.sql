ALTER TABLE echo_character_gallery ADD COLUMN IF NOT EXISTS vision_analysis jsonb;
ALTER TABLE echo_character_gallery ADD COLUMN IF NOT EXISTS vision_status text NOT NULL DEFAULT 'pending';
