---
name: Wouter onboarding routes
description: Preserve stateful onboarding component state during parent updates in Wouter routes.
---

For onboarding pages inside `Switch`, render the page as a stable route child rather than passing a newly created inline `component={() => ...}` function. Parent rerenders during mutation state changes can otherwise replace the route component and reset the form before the success screen appears, even if the server save succeeded.

**Why:** the disposable Clerk browser flow reached a successful owner-scoped save but the inline route wrapper remounted onboarding during the async save, preventing completion from being shown.

**How to apply:** use stable child elements or a module-scope component for stateful pages rendered beneath Wouter routes that sit inside a parent with async state.
