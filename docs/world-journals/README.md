# ECHO World Journals — implementation contract

Status: **draft**, not deployed. SQL is a proposed migration; verify actual universe ID type and auth model before running.

## UX
World Settings → Journals: list/search by title, category, keyword and status; create/edit; preview who knows; publish/archive. AI can propose an editable draft after meaningful events. The creator must explicitly approve publication. No automatic publishing.

## Entry types
- world_knowledge: canon, e.g. Blackthorne magical disciplines
- shared_memory: witnessed events
- secret: limited character knowledge

Separate **truth_status** (confirmed/rumor/belief/unknown) from visibility; knowing a rumor does not make it true.

## Server API proposal
GET /universes/:id/journals — only authorized human collaborators.
POST /universes/:id/journals — create draft; ignore client supplied approval.
PATCH /universes/:id/journals/:journalId — edit authorized draft; revalidate character IDs.
POST /universes/:id/journals/:journalId/publish — explicit human approval, set approved_by/approved_at atomically.
POST /universes/:id/journals/suggest — AI-generated draft; user can edit, discard or publish.
POST /universes/:id/journals/retrieve — server-only prompt assembly, authenticated character and universe context.

## Retrieval rules
1. Resolve active universe from authenticated session, never trust client-only universe selection.
2. Verify that the character belongs to this universe.
3. Retrieve published journals only, filtered by knowledge_scope: everyone or selected IDs.
4. Rank by exact keywords, then relevance and recency; cap prompt tokens.
5. Render rumor/belief as attributed uncertain knowledge, not factual canon.
6. Keep editing permissions independent of knowledge permissions.
7. Do not leak private entries through counts, search results, notifications, summaries or AI suggestions.
8. Sharing a world grants only the configured human permissions; it must not make every character omniscient.

## Before deployment
- Check existing echo_universes primary key type and schema conventions.
- Integrate into existing API/router, auth middleware, migrations and UI.
- Add tests for cross-universe isolation, nonmember denial, secret leakage, approval, edit and rollback.
- Back up database and deploy behind a feature flag.
