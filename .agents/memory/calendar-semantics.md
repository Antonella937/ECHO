---
name: Character calendar semantics
description: Preserve wall-clock routine dates separately from timestamp instants across generated schemas.
---

A one-off routine's calendar date is a local `YYYY-MM-DD` string interpreted with the character's timezone, not a timestamp instant.

**Why:** This workspace's OpenAPI/Zod generator is configured to coerce formatted dates into JavaScript Dates. A `date` format on a calendar-only field therefore changes its serialized value during a server round trip, while existing timestamp fields intentionally use the established date coercion.

**How to apply:** Keep calendar-only routine dates constrained as strings, validate actual calendar validity, and test exact string round trips. Do not globally change timestamp coercion to fix a calendar-date field. Overnight blocks belong to their starting day; timezone/DST previews should remain contextual rather than claiming precise autonomous execution.
