# World Journals — release gate (NOT YET PASSED)

No production migration, deployment, or GitHub Actions run is authorized by this checklist.

## Verified locally
- Isolated `worldJournalAudience` unit tests: 8/8 pass (Node 22).
- Isolated `worldJournalAudience.ts` strict TypeScript check: pass.
- These checks do **not** validate the full monorepo or database queries.

## Required before release
1. Install the feature branch dependencies in a clean workspace. Run `pnpm --filter @workspace/api-server typecheck`, `pnpm --filter @workspace/api-server test:world-journals`, and the frontend build/typecheck. Record actual outputs.
2. Use an **isolated test database**, never production. Apply `artifacts/api-server/migrations/20261112_world_journals.sql` there. Verify the table and constraints.
3. Create two test universes under the same test owner. Confirm that entries never cross universe boundaries and cannot be accessed by a different owner.
4. Create a secret selected for Ophelia only. Confirm that Ophelia's knowledge endpoint and DM recall can return it, but Lucien's cannot. Check both the native engine and Kindroid path.
5. Verify `draft`, `archived`, and `nobody` entries are never retrieved as AI context. Confirm rumors are labeled unverified.
6. Approve a draft, edit it, and verify it reverts to draft and disappears from AI recall until re-approved. Test an edit racing with approval.
7. Remove/archive a previously authorized character; confirm their knowledge endpoint and DM recall reject access.
8. Open universe A's Journal UI, switch to B while fetch/save/approve/archive is pending, and confirm A's entries and errors never appear in B.
9. Confirm a secret cannot be saved as public, and selected scope cannot have an empty audience, at both API and database layers.
10. Only after all gates pass, request explicit permission for production migration and one deployment.

## Known limitation
The API proposal endpoint stores user-submitted AI-labeled drafts; it does not itself autonomously generate proposals. Do not advertise automatic AI suggestions as complete.
