-- ECHO World Journals: additive schema, no existing universe data changed.
CREATE TABLE IF NOT EXISTS echo_world_journals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL,
 universe_id text NOT NULL,
 title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
 content text NOT NULL CHECK (length(trim(content)) > 0),
 category text NOT NULL CHECK (category IN ('world_knowledge','shared_memory','secret')),
 truth_status text NOT NULL DEFAULT 'confirmed' CHECK (truth_status IN ('confirmed','rumor','belief','unknown')),
 keywords text[] NOT NULL DEFAULT '{}',
 knowledge_scope text NOT NULL DEFAULT 'selected' CHECK (knowledge_scope IN ('everyone','selected','nobody')),
 known_character_ids text[] NOT NULL DEFAULT '{}',
 edit_scope text NOT NULL DEFAULT 'owner' CHECK (edit_scope IN ('owner','collaborators')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
 source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','ai_suggestion','conversation')),
 source_reference text,
 created_by text NOT NULL,
 approved_by text,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT journal_published_requires_approval CHECK (status <> 'published' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_echo_world_journals_universe_status ON echo_world_journals(owner_id,universe_id,status);
CREATE INDEX IF NOT EXISTS idx_echo_world_journals_keywords ON echo_world_journals USING gin(keywords);
CREATE INDEX IF NOT EXISTS idx_echo_world_journals_known ON echo_world_journals USING gin(known_character_ids);
-- Security requirements for API integration:
-- Verify universe membership and write permissions server-side for every request.
-- Never expose secrets to characters absent from known_character_ids.
-- AI suggestions must remain draft until an authorized human edits/approves.
-- Resolve character IDs within the same universe; reject cross-universe references.
-- Query only published entries and filter visibility before prompt retrieval.
