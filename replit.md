# ECHO

A mobile-first fictional-character social network, experienced as Nela Paez's own account.

## Product boundaries

- Nela Paez is the default active character. Mar Mulligan and Noah Hayes have distinct profiles and sample activity.
- Preserve the approved dark charcoal appearance, muted pink accent and comfortable rounded controls across all screens.
- Character switching is a secondary control, not an admin dashboard.
- This first prototype is local-only: seeded activity is simulated, not autonomous AI.
- There is no secure sign-in or server-enforced privacy yet. Do not describe this prototype as an authenticated private network.
- Future integrations may attach Kindroid Kin IDs and image-generation identity references; never expose provider credentials in client code.

## Run & operate

- Managed frontend workflow: `artifacts/echo: web`.
- Frontend package: `artifacts/echo`, served at `/`.
- `pnpm --filter @workspace/echo run typecheck` checks the frontend.
- The shared API scaffold exists but ECHO does not require it for this prototype.
- No API keys or database setup are needed.

## Source map

- `artifacts/echo/src/domain/`: social models, typed activity events and future provider interfaces.
- `artifacts/echo/src/store/`: seeded content, persistent browser repository and React state.
- `artifacts/echo/src/pages/`: feed, profiles, creation, notifications, messages and settings.
- `artifacts/echo/src/components/echo/`: shared social components and viewers.
- `artifacts/echo/src/assets/media/`: illustrative character photography.
- `artifacts/echo/public/`: install manifest, icons and production-only offline service worker.

## Persistence and installation

User content stays in the current browser, using IndexedDB with localStorage fallback. Clearing site data removes it; nothing syncs between devices. Shared post links refer to this browser's local dataset.

The manifest enables standalone phone use on compatible browsers. The production service worker caches the shell and visited static assets; it does not cache APIs or third-party requests. Offline use requires an initial online visit.

## Future integration constraints

Keep external character and image providers behind the domain contracts. Autonomous activity must enter through typed social events rather than mutate views directly. Real authentication and server-side persistence are a separate phase, not implied by the character switcher.
