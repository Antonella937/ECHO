---
name: Development schema push ordering
description: A development schema-push ordering issue encountered when adding required universe columns and composite keys.
---

When adding a non-null universe key to existing Vision tables, the first Drizzle push attempted to apply `SET NOT NULL` before the column existed. The operation failed without changing rows. Applying the additive column/default/backfill/constraint changes in one explicit development transaction, then rerunning the non-forced schema push, succeeded.

**Why:** The workspace's schema-push ordering did not safely handle adding the required column and composite keys in one diff; a forced push would risk bypassing data-preserving checks.

**How to apply:** Before future development schema pushes that add required partition keys to populated tables, inspect the generated behavior and current data. Prefer additive, defaulted/backfilled columns and verify preserved row counts/fingerprints before and after; never switch to force-push.
