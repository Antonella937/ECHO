-- One credit is one generated character audio reply (maximum 30 seconds).
-- This ledger is independent from existing TTS character-count usage.
CREATE TABLE IF NOT EXISTS echo_audio_credit_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL,
 month_key text NOT NULL,
 request_key text NOT NULL,
 character_id text NOT NULL,
 engine text NOT NULL CHECK (engine IN ('kokoro','custom')),
 duration_seconds numeric(7,2) NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 30),
 credits integer NOT NULL DEFAULT 1 CHECK (credits = 1),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (owner_id,request_key)
);
CREATE INDEX IF NOT EXISTS echo_audio_credit_usage_month_idx ON echo_audio_credit_usage(owner_id,month_key);

-- A separate subscription for EACH customized voice, even when multiple voices
-- belong to the same character. No prices or payment providers are assumed.
CREATE TABLE IF NOT EXISTS echo_custom_voice_addons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL,
 universe_id text NOT NULL,
 character_id text NOT NULL,
 voice_slot_id uuid NOT NULL DEFAULT gen_random_uuid(),
 provider_voice_id text,
 billing_subscription_id text UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','past_due','paused','cancelled')),
 current_period_end timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (owner_id,universe_id,character_id,voice_slot_id)
);
CREATE INDEX IF NOT EXISTS echo_custom_voice_addons_owner_idx ON echo_custom_voice_addons(owner_id,universe_id,character_id);
