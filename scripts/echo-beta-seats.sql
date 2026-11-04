-- Run once against the ECHO PostgreSQL database before enabling public beta registration.
-- Seat allocation is serialized by the application transaction's advisory lock.
CREATE TABLE IF NOT EXISTS echo_beta_seats (
  owner_id TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
