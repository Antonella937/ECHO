ALTER TABLE echo_group_member_preferences ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
