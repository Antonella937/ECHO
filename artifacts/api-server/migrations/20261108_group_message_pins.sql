ALTER TABLE echo_group_messages ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE echo_group_messages ADD COLUMN IF NOT EXISTS pinned_by text;
