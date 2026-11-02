# ECHO

A mobile-first fictional-character social network, experienced as Nela Paez's own account.

## Product boundaries

- Nela Paez is the default active character. Mar Mulligan and Noah Hayes have distinct profiles and sample activity.
- Preserve the approved dark charcoal appearance, muted pink accent and comfortable rounded controls across all screens.
- Character switching is a secondary control, not an admin dashboard.
- Seeded activity is simulated, not autonomous AI.
- Clerk login gates ECHO. The server derives universe ownership exclusively from the authenticated user, never from the active character.
- Future integrations may attach Kindroid Kin IDs and image-generation identity references; never expose provider credentials in client code.

## Run & operate

- Managed frontend workflow: `artifacts/echo: web`.
- Frontend package: `artifacts/echo`, served at `/`.
- `pnpm --filter @workspace/echo run typecheck` checks the frontend.
- The shared API server is required for authenticated universe access and private images.
- Authentication and App Storage are configured; Kindroid and visual AI are not connected.
- `pnpm --filter @workspace/scripts run test:echo-privacy` runs synchronization, migration, database concurrency and real private image storage tests.
- `pnpm --filter @workspace/scripts run test:echo-accounts` checks additive account upgrades, edit validation, reversible archive, fictional metrics and stale-open form safety.
- `pnpm --filter @workspace/scripts run test:echo-inbox` checks empty new inboxes and preserves existing/migrated message history.
- `pnpm --filter @workspace/scripts run test:echo-ux` uses disposable authenticated sessions to check conversation search/start/send/history and mobile layout at 320/390/430px, including simulated bottom safe area and a shortened conversation viewport.
- `pnpm --filter @workspace/scripts run test:echo-browser` exercises the real signed-in UI in disposable Clerk development accounts, including uploads, manual posting, a second session and cross-owner isolation. It deletes only its own test users/universes/files; never run it against production.
- `pnpm run typecheck` is the canonical check; it builds shared declarations before checking apps.

## Source map

- `artifacts/echo/src/domain/`: social models, typed activity events and future provider interfaces.
- `artifacts/echo/src/store/`: seeded content, owner-scoped recovery, versioned synchronization, conflict resolution and React state.
- `artifacts/echo/src/pages/`: feed, profiles, creation, notifications, messages and settings.
- `artifacts/echo/src/components/echo/`: shared social components and viewers.
- `artifacts/echo/src/assets/media/`: illustrative character photography.
- `artifacts/echo/public/`: install manifest, icons and production-only offline service worker.

## Persistence and installation

User content is saved in PostgreSQL per authenticated owner; private image bytes live in App Storage with owner checks. Atomic revision checks reject stale writes. Clients combine independent edits, ask the user about incompatible edits and refresh every five seconds, on focus and on reconnect. Each device keeps its own active-character choice without changing the login owner.

Pending changes have an owner-scoped IndexedDB recovery snapshot. Network failure must not discard that snapshot. Legacy local data is never deleted: users explicitly import it into the signed-in account, combining entities by stable id. A local ownership claim prevents the same legacy backup being offered to another signed-in owner. Import completion requires a separate server re-read plus successful reads of the referenced private files. Import receipts and converted-image mappings prevent repeated imports/uploads from duplicating content. Incompatible local schema versions fail explicitly.

The manifest enables standalone phone use on compatible browsers. The production service worker caches the shell and visited static assets; it does not cache APIs or third-party requests. Offline use requires an initial online visit.

## Account editing and audience figures

All social profiles, including Nela, are editable by their authenticated universe owner. Personal, band, venue and organization accounts share the same interaction capabilities. Additive catalog initialization supplies editable official Pretty Violence, False Halo, Saint Vulture, Stray Kids, The Hollow and Dead Static accounts once; it never replaces existing accounts, resets the universe or revives archived accounts.

Account removal is reversible archive, not deletion. Nela cannot be archived. Archive keeps posts, messages, comments and historical relationships, hides the account from identity selection and returns an archived active identity to Nela. Settings has no destructive demo-reset control.

Manual audience figures are fictional **bases added to real activity**, not fabricated relationship or interaction records. Blank bases mean no fictional addition. Editors show the real counts separately. New optional JSON fields preserve compatibility with Stage 1 snapshots. Profile/metric forms apply only fields changed since opening and reject incompatible intervening edits, even when polling has already advanced the client's sync base.

## Character studio (ECHO Base)

`/characters/new` offers quick, advanced and assisted creation; `/characters/:id/edit` edits every account, including Nela and official profiles. Settings > Crear personaje and profile > Ficha de personaje are the entry points. The existing simple account editor remains available for account type, verification and fictional audience bases.

The optional, versioned `Character.configuration` is specified in OpenAPI and validated with the same generated Zod contract on client and server. Existing profiles use lazy defaults, not a destructive rewrite. Rich forms retain an opening snapshot and merge unchanged fields before saving. All configuration remains inside the owner-private, revision-controlled universe.

Relations distinguish the universe owner (`owner`) from social identities. Routine entries use character timezones and **date-only strings** for one-off calendar events; they are contextual previews, not schedules that run activity. Current state is manually correctable. Recent memory indexes real post/story/comment/message events with a bounded limit; trimming this index never deletes social history or permanent/relationship memories.

Duplication copies the designed ficha and durable memories, not social history/recent memory/audience/verification/external connections. Only unused accounts may be permanently deleted, with typed username confirmation; Nela is protected. If another device creates history while an unused account is being deleted, synchronization retains that account as archived rather than orphaning content.

No text-model provider is configured. The private `/api/characters/assistance` availability endpoint reports this explicitly and POST returns 503 without generation or mutations. The assisted UI can retain an owner-written brief and continue manually; it does not pretend to generate. No Kindroid, visual generation, TTS or autonomous activity was introduced.

- `pnpm --filter @workspace/scripts run test:echo-characters`: character defaults, schema round-trip, deep edits/conflicts, relationships, dates/timezones/overnight/DST context, memory bounds, duplication and safe deletion.
- `pnpm --filter @workspace/scripts run test:echo-character-browser`: disposable real-auth browser flow through all seven sections, manual-assisted fallback, memory promotion, two fresh browser contexts, lifecycle and 320/390/430px safe-area geometry.

## Mobile layout and conversations

Keep mobile navigation clearance and its safe-area inset coordinated through the shared CSS variables. All regular pages reserve bottom clearance; conversation pages hide navigation and reserve space for their own composer. Sheets overlay navigation and have their own safe-area padding. Browser checks assert actual computed padding/control bounds rather than only checking class names.

New universes contain no seeded DMs or message notifications. The inbox is derived from actual persisted messages, not every available account. Existing messages of any origin, including old sample and migrated history, are never removed by this UI change. Choosing a recipient only opens a draft conversation; sending the first message makes it appear in the inbox. Search lists exclude archived accounts, while existing archived-account history remains visible.

## Future integration constraints

Keep external character and image providers behind the domain contracts. Autonomous activity must enter through typed social events rather than mutate views directly. The character switcher must never alter authenticated ownership.
