-- Staging migration: atomic, idempotent application of provider-verified
-- one-time purchases. NEVER expose this function directly to clients.
-- A trusted server process must first verify payment status, reference,
-- amount and owner against Mercado Pago and insert the verified receipt.
CREATE OR REPLACE FUNCTION echo_apply_verified_slot_receipt(p_payment_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  receipt record;
BEGIN
  SELECT * INTO receipt
    FROM echo_mp_payment_receipts
    WHERE provider_payment_id = p_payment_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF receipt.applied_at IS NOT NULL THEN RETURN false; END IF;
  IF receipt.provider_status <> 'approved'
     OR receipt.paid_at IS NULL
     OR receipt.purchase_kind NOT IN ('character_slot','world_slot')
     OR receipt.currency <> 'ARS' THEN
    RETURN false;
  END IF;

  INSERT INTO echo_creator_entitlements (owner_id)
    VALUES (receipt.owner_id)
    ON CONFLICT (owner_id) DO NOTHING;

  IF receipt.purchase_kind = 'character_slot' THEN
    UPDATE echo_creator_entitlements
      SET addon_characters = addon_characters + 1, updated_at = now()
      WHERE owner_id = receipt.owner_id;
  ELSE
    UPDATE echo_creator_entitlements
      SET addon_universes = addon_universes + 1,
          addon_characters = addon_characters + 5,
          updated_at = now()
      WHERE owner_id = receipt.owner_id;
  END IF;

  UPDATE echo_mp_payment_receipts
    SET applied_at = now()
    WHERE provider_payment_id = p_payment_id AND applied_at IS NULL;
  RETURN true;
END;
$$;
-- Keep application privilege limited to the trusted backend database role.
