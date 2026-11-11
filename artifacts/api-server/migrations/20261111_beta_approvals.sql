-- Apply before enabling ECHO_BETA_APPROVAL_REQUIRED=true.
CREATE TABLE IF NOT EXISTS echo_beta_approvals (
  owner_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Existing founders should be explicitly approved before turning the gate on.
