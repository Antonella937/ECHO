---
name: Character privacy scope
description: The product distinction between storing a character visibility preference and enforcing access to social content.
---

Per-character `public`/`private` visibility is only a persisted owner setting until profile, feed, post, and Story read paths enforce it. Do not present a private setting as protecting content before those server-side read checks exist.

**Why:** the user explicitly scoped the initial privacy step to persistence and owner-only changes, while deferring social read enforcement and requiring that it not be described as complete privacy.

**How to apply:** in ECHO privacy work, keep this limitation visible in status reports and beta readiness decisions until the relevant read APIs enforce the setting.
