-- Apply to an isolated staging database only.
-- Claim a draft before contacting Mercado Pago so concurrent requests cannot
-- create multiple recurring subscriptions for the same reference.
ALTER TABLE echo_mp_subscription_intents
  DROP CONSTRAINT IF EXISTS echo_mp_subscription_intents_status_check;
ALTER TABLE echo_mp_subscription_intents
  ADD CONSTRAINT echo_mp_subscription_intents_status_check
  CHECK (status IN ('draft','creating','pending','authorized','paused','canceled','failed'));
CREATE INDEX IF NOT EXISTS echo_mp_checkout_claims_idx
  ON echo_mp_subscription_intents(status, updated_at)
  WHERE status = 'creating';
-- A 'creating' row with no provider ID is ambiguous: the provider may have
-- created a subscription before a timeout. Never retry it automatically.
