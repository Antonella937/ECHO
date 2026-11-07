-- Each character has exactly one custom voice billing slot at most.
-- Changing its voice updates that slot instead of adding a second subscription.
CREATE UNIQUE INDEX IF NOT EXISTS echo_custom_voice_addons_one_per_character ON echo_custom_voice_addons(owner_id,universe_id,character_id);
