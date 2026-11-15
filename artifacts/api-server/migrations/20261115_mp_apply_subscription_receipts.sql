-- Staging only. Called exclusively by a trusted backend after it has
-- verified the payment with Mercado Pago and persisted a receipt.
-- Payment confirmation alone does not establish the subscription period.
-- The caller must independently establish the covered billing period.
CREATE OR REPLACE FUNCTION echo_apply_verified_subscription_receipt(
  p_payment_id text,
  p_period_end timestamptz
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  receipt record;
  intent record;
BEGIN
  SELECT * INTO receipt FROM echo_mp_payment_receipts
    WHERE provider_payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR receipt.applied_at IS NOT NULL THEN RETURN false; END IF;
  IF receipt.purchase_kind <> 'subscription'
     OR receipt.provider_status <> 'approved'
     OR receipt.paid_at IS NULL
     OR receipt.currency <> 'ARS'
     OR receipt.provider_preapproval_id IS NULL THEN
    RETURN false;
  END IF;
  IF p_period_end IS NULL
     OR p_period_end <= receipt.paid_at
     OR p_period_end > receipt.paid_at + INTERVAL '35 days' THEN
    RETURN false;
  END IF;

  SELECT * INTO intent FROM echo_mp_subscription_intents
    WHERE reference = receipt.reference
      AND owner_id = receipt.owner_id
      AND provider_preapproval_id = receipt.provider_preapproval_id
      AND amount_ars = receipt.amount_ars
      AND currency = receipt.currency
      AND plan IN ('plus','premium');
  IF NOT FOUND THEN RETURN false; END IF;

  -- A late payment from an old subscription must never downgrade a newer
  -- paid period or replace another plan that is still active.
  INSERT INTO echo_subscriptions(owner_id,plan,status,current_period_end,updated_at)
    VALUES(receipt.owner_id,intent.plan,'active',p_period_end,now())
    ON CONFLICT(owner_id) DO UPDATE
      SET plan = EXCLUDED.plan,
          status = 'active',
          current_period_end = EXCLUDED.current_period_end,
          updated_at = now()
      WHERE echo_subscriptions.current_period_end IS NULL
         OR echo_subscriptions.current_period_end < EXCLUDED.current_period_end;

  UPDATE echo_mp_payment_receipts SET applied_at = now()
    WHERE provider_payment_id = p_payment_id AND applied_at IS NULL;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION echo_apply_verified_subscription_receipt(text,timestamptz) FROM PUBLIC;
