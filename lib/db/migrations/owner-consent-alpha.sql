-- Additive only. Existing owners have no acknowledgement; no inferred/backfilled consent.
-- This table stores alpha drafts, NOT valid legal acceptance or verified ages.
CREATE TABLE IF NOT EXISTS echo_owner_consents (
  owner_id text NOT NULL,
  version text NOT NULL,
  adult_declared boolean NOT NULL DEFAULT false,
  fiction_acknowledged boolean NOT NULL DEFAULT false,
  legal_draft_acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, version)
);
