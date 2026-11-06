-- Voice generation defaults OFF for every user, including existing beta owners.
CREATE TABLE IF NOT EXISTS echo_voice_budgets (
  owner_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  monthly_character_limit integer NOT NULL DEFAULT 0 CHECK (monthly_character_limit BETWEEN 0 AND 1000000),
  max_daily_messages integer NOT NULL DEFAULT 0 CHECK (max_daily_messages BETWEEN 0 AND 100),
  preference text NOT NULL DEFAULT 'off' CHECK (preference IN ('off','occasional','frequent')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS echo_voice_usage (
  owner_id text NOT NULL,
  message_id text NOT NULL,
  month_key text NOT NULL,
  character_id text NOT NULL,
  characters integer NOT NULL CHECK (characters BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('reserved','succeeded','failed')),
  object_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, message_id)
);
CREATE INDEX IF NOT EXISTS echo_voice_usage_month ON echo_voice_usage(owner_id, month_key);
CREATE INDEX IF NOT EXISTS echo_voice_usage_daily ON echo_voice_usage(owner_id, created_at);
