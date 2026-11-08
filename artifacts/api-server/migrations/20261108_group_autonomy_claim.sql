ALTER TABLE echo_group_conversations ADD COLUMN IF NOT EXISTS autonomy_claim_id text;
ALTER TABLE echo_group_conversations ADD COLUMN IF NOT EXISTS autonomy_claim_until timestamptz;
