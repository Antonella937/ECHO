-- ECHO migration verification (READ ONLY). Run after backfill and before cutover.
-- Parameters: $1 = owner_id, $2 = universe_id.
-- No cross-tenant scans; all comparisons are scoped to a single universe.
-- A result with ANY mismatch is a hard stop. Source revision must remain
-- unchanged from the migration checkpoint, otherwise rerun the backfill.
WITH source AS (
 SELECT owner_id, universe_id, revision, state
 FROM echo_universes WHERE owner_id = $1 AND universe_id = $2
), source_characters AS (
 SELECT c.value->>'id' AS id, c.value AS payload
 FROM source s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'characters', '[]'::jsonb)) c(value)
), source_posts AS (
 SELECT p.value->>'id' AS id, p.value AS payload
 FROM source s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'posts', '[]'::jsonb)) p(value)
), source_messages AS (
 SELECT m.value->>'id' AS id, m.value AS payload
 FROM source s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.state->'messages', '[]'::jsonb)) m(value)
), comparison AS (
 SELECT 'characters' AS collection, sc.id, sc.payload AS original, t.profile AS migrated
 FROM source_characters sc FULL JOIN
 (SELECT character_id, profile FROM echo_character_records WHERE owner_id = $1 AND universe_id = $2) t
 ON sc.id = t.character_id
 UNION ALL
 SELECT 'posts', sp.id, sp.payload, t.payload
 FROM source_posts sp FULL JOIN
 (SELECT post_id, payload FROM echo_post_records WHERE owner_id = $1 AND universe_id = $2) t
 ON sp.id = t.post_id
 UNION ALL
 SELECT 'messages', sm.id, sm.payload, t.payload
 FROM source_messages sm FULL JOIN
 (SELECT message_id, payload FROM echo_message_records WHERE owner_id = $1 AND universe_id = $2) t
 ON sm.id = t.message_id
)
SELECT collection, count(*) AS compared,
       count(*) FILTER (WHERE original IS DISTINCT FROM migrated) AS mismatched_payloads,
       count(*) FILTER (WHERE original IS NULL) AS extra_rows,
       count(*) FILTER (WHERE migrated IS NULL) AS missing_rows
FROM comparison GROUP BY collection ORDER BY collection;
-- IMPORTANT: also check that IDs in source arrays are unique. Duplicate IDs
-- can cause a backfill upsert conflict or collapse two distinct entries.
-- This query verifies only profiles/posts/messages; comments, stories,
-- relationships, notifications and memory archives require separate parity
-- checks before retiring the legacy JSON source of truth.
