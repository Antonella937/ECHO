---
name: Frontend SSR runner context
description: Frontend components tested from the API tsx runner need an explicit React JSX scope.
---

Pure frontend TSX components exercised by the existing API-hosted tsx/Node SSR runner need React in scope, even though Vite supports the automatic JSX runtime.

**Why:** New components rendered correctly in Vite but their SSR tests failed with “React is not defined” when launched through the API package's test environment.

**How to apply:** Preserve explicit React imports in components used by this runner, or deliberately configure a supported dedicated JSX test environment. Do not suppress the failure, remove assertions, or assume the browser transform is the test transform.
