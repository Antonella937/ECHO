---
name: ECHO usage budget boundaries
description: Internal AI budget semantics, owner-wide accounting, and the protected Autonomy allocation.
---

AI ceilings and category weights are internal safety controls, not customer-facing plan quotas. Structural character/universe add-ons do not add AI budget. The configured Autonomy reserve is protected from other categories, and Autonomy has its own maximum below the full monthly ceiling.

**Why:** The user explicitly said the internal ceiling is a technical calibration value, not a final commercial allowance, add-ons must not grant an extra AI pool, and Autonomy must neither be starved by other categories nor consume the whole budget.

**How to apply:** Keep accounting owner-wide across universes; reserve units before calling an external provider; enforce the protected Autonomy portion, Autonomy's individual cap, and the total ceiling. Never present these internal controls as plan promises.
