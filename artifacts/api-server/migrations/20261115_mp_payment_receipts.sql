-- Payment evidence ledger for Mercado Pago subscriptions and permanent slot purchases.
-- Apply in staging only after reviewing the provider integration.
-- A subscription authorization or checkout redirect is not a captured payment.
CREATE TABLE IF NOT EXISTS echo_mp_payment_receipts (
  provider_payment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  purchase_kind TEXT NOT NULL CHECK (purchase_kind IN ('subscription','character_slot','world_slot')),
  provider_preapproval_id TEXT,
  amount_ars NUMERIC(12,2) NOT NULL CHECK (amount_ars > 0),
  currency TEXT NOT NULL CHECK (currency = 'ARS'),
  provider_status TEXT NOT NULL CHECK (provider_status IN ('approved','refunded','charged_back')),
  paid_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  -- Refunds and chargebacks may arrive after a grant was applied. Preserve
  -- that history rather than blocking the provider status update.
  CHECK (applied_at IS NULL OR paid_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS echo_mp_receipts_owner_idx ON echo_mp_payment_receipts(owner_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS echo_mp_receipts_reference_idx ON echo_mp_payment_receipts(reference);
-- Each receipt is keyed by the provider's unique payment ID so repeated
-- webhook deliveries cannot create a second entitlement grant.

-- An applied receipt can subsequently be refunded or charged back. The
-- corresponding entitlement reversal is a separate, mandatory reconciliation
-- operation; do not silently treat the original grant as still valid.
CREATE INDEX IF NOT EXISTS echo_mp_receipts_reversal_idx
  ON echo_mp_payment_receipts(provider_status, applied_at)
  WHERE applied_at IS NOT NULL AND provider_status IN ('refunded','charged_back');
