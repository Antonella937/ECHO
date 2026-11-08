ALTER TABLE echo_group_conversations ADD COLUMN IF NOT EXISTS autonomy_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE echo_group_conversations ADD COLUMN IF NOT EXISTS autonomy_interval_minutes integer NOT NULL DEFAULT 60;
