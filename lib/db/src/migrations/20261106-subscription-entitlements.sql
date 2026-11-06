-- No self-service upgrades. Payment/webhook integration will grant paid access later.
-- Missing rows, canceled subscriptions and expired periods all resolve to Free.
CREATE TABLE IF NOT EXISTS echo_subscriptions (
  owner_id text PRIMARY KEY,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','plus','premium')),
  status text NOT NULL DEFAULT 'canceled' CHECK (status IN ('active','trialing','past_due','canceled')),
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
