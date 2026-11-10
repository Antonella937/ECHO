-- ECHO migration: one-universe, idempotent backfill template.
-- Requires 01-partitioned-social-data.sql. NOT executed automatically.
-- Run in a transaction with the owner/universe parameters provided by a
-- trusted migration runner; never accept owner_id from a client request.
-- Existing echo_universes.state remains authoritative during this phase.
--
-- Parameters: $1 = owner_id, $2 = universe_id.
-- Assumes echo_universes columns owner_id, universe_id, state (jsonb), revision.
-- Validate actual physical schema and take a backup before execution.
BEGIN;
-- Lock only the target universe to prevent concurrent writes during its snapshot.
SELECT revision FROM echo_universes
 WHERE owner_id = $1 AND universe_id = $2
 FOR SHARE;
INSERT INTO echo_character_records (owner_id, universe_id, character_id, profile)
SELECT u.owner_id, u.universe_id, c.value->>'id', c.value
FROM echo_universes AS u
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.state->'characters', '[]'::jsonb)) AS c(value)
WHERE u.owner_id = $1 AND u.universe_id = $2
  AND NULLIF(c.value->>'id', '') IS NOT NULL
ON CONFLICT (owner_id, universe_id, character_id)
DO UPDATE SET profile = EXCLUDED.profile, updated_at = now();
INSERT INTO echo_post_records (owner_id, universe_id, post_id, author_id, published_at, payload)
SELECT u.owner_id, u.universe_id, p.value->>'id', p.value->>'authorId',
       (p.value->>'createdAt')::timestamptz, p.value
FROM echo_universes AS u
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.state->'posts', '[]'::jsonb)) AS p(value)
WHERE u.owner_id = $1 AND u.universe_id = $2
  AND NULLIF(p.value->>'id', '') IS NOT NULL
  AND NULLIF(p.value->>'authorId', '') IS NOT NULL
  AND NULLIF(p.value->>'createdAt', '') IS NOT NULL
ON CONFLICT (owner_id, universe_id, post_id)
DO UPDATE SET author_id = EXCLUDED.author_id, published_at = EXCLUDED.published_at,
              payload = EXCLUDED.payload;
INSERT INTO echo_message_records (owner_id, universe_id, message_id, thread_id, sent_at, payload)
SELECT u.owner_id, u.universe_id, m.value->>'id', m.value->>'threadId',
       (m.value->>'createdAt')::timestamptz, m.value
FROM echo_universes AS u
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.state->'messages', '[]'::jsonb)) AS m(value)
WHERE u.owner_id = $1 AND u.universe_id = $2
  AND NULLIF(m.value->>'id', '') IS NOT NULL
  AND NULLIF(m.value->>'threadId', '') IS NOT NULL
  AND NULLIF(m.value->>'createdAt', '') IS NOT NULL
ON CONFLICT (owner_id, universe_id, message_id)
DO UPDATE SET thread_id = EXCLUDED.thread_id, sent_at = EXCLUDED.sent_at,
              payload = EXCLUDED.payload;
-- Important: this upsert does NOT delete stale rows. Compare stable IDs and
-- checksums before switching reads; only reconcile deletions in a reviewed
-- second pass, after source revision is verified unchanged.
COMMIT;
