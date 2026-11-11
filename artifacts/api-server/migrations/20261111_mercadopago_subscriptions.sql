-- Mercado Pago subscription intent ledger. No entitlement changes are made from these rows.
CREATE TABLE IF NOT EXISTS echo_mp_subscription_intents (
  reference TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('plus','premium')),
  currency TEXT NOT NULL DEFAULT 'ARS' CHECK (currency='ARS'),
  amount_ars NUMERIC(12,2) NOT NULL CHECK (amount_ars>0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','authorized','paused','canceled','failed')),
  provider_preapproval_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_mp_intents_owner_idx ON echo_mp_subscription_intents(owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS echo_mp_webhook_events (
  event_key TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  provider_resource_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','rejected','failed'))
);

-- Immutable provider payment observations, separate from entitlement grants.
-- One provider payment can be recorded only once, even across webhook retries.
CREATE TABLE IF NOT EXISTS echo_mp_verified_payments (
  provider_payment_id TEXT PRIMARY KEY,
  reference TEXT NOT NULL REFERENCES echo_mp_subscription_intents(reference),
  provider_preapproval_id TEXT NOT NULL,
  provider_status TEXT NOT NULL CHECK (provider_status IN ('approved','pending','rejected','refunded','charged_back','unknown')),
  amount_ars NUMERIC(12,2),
  currency TEXT,
  provider_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_mp_verified_payments_reference_idx
  ON echo_mp_verified_payments(reference, recorded_at DESC);
-- This ledger is not an access-control source: payment reversals and the paid-through
-- period must be reconciled before any membership is activated.
