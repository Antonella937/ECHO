-- ECHO source-integrity preflight (READ ONLY).
-- Execute before attempting 03-backfill-social-data.sql.
-- $1 = trusted owner_id, $2 = universe_id. Never accept owner_id from a client.
-- Any result row indicates a migration blocker; fix data carefully, not by
-- silently dropping characters, posts or messages.
WITH universe AS (
 SELECT state, revision FROM echo_universes
 WHERE owner_id = $1 AND universe_id = $2
), entities AS (
 SELECT 'characters' AS kind, c.value AS item
 FROM universe u CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.state->'characters','[]'::jsonb)) c(value)
 UNION ALL
 SELECT 'posts', p.value
 FROM universe u CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.state->'posts','[]'::jsonb)) p(value)
 UNION ALL
 SELECT 'messages', m.value
 FROM universe u CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.state->'messages','[]'::jsonb)) m(value)
), identifiers AS (
 SELECT kind, item, NULLIF(item->>'id','') AS entity_id,
        CASE WHEN kind = 'posts' THEN NULLIF(item->>'authorId','')
             WHEN kind = 'messages' THEN NULLIF(item->>'threadId','') END AS required_link,
        CASE WHEN kind IN ('posts','messages') THEN NULLIF(item->>'createdAt','') END AS timestamp_value
 FROM entities
), duplicates AS (
 SELECT kind, entity_id, count(*) AS occurrences
 FROM identifiers WHERE entity_id IS NOT NULL
 GROUP BY kind, entity_id HAVING count(*) > 1
)
SELECT kind, COALESCE(entity_id,'<missing>') AS entity_id, 'missing id' AS problem
FROM identifiers WHERE entity_id IS NULL
UNION ALL
SELECT kind, entity_id, 'duplicate id: ' || occurrences::text
FROM duplicates
UNION ALL
SELECT kind, COALESCE(entity_id,'<missing>'), 'missing required author/thread'
FROM identifiers WHERE kind IN ('posts','messages') AND required_link IS NULL
UNION ALL
SELECT kind, COALESCE(entity_id,'<missing>'), 'missing timestamp'
FROM identifiers WHERE kind IN ('posts','messages') AND timestamp_value IS NULL
ORDER BY kind, entity_id, problem;
-- NOTE: This check deliberately does NOT cast timestamps, so it cannot fail
-- on malformed date strings. The migration runner must additionally validate
-- timestamp parseability before casting them in the backfill.
-- Source revision must be rechecked inside the backfill transaction.
