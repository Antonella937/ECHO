/** Server-owned complimentary access. Clerk user IDs are stable across email changes.
 * Never use this list to bypass AI usage safety ceilings or authentication.
 * Billing integrations must check lifetimeAccessForOwner before charging.
 */
export type LifetimeAccess = "owner_lifetime" | "founder_lifetime";

const LIFETIME_ACCESS_BY_CLERK_ID: Readonly<Record<string, LifetimeAccess>> = Object.freeze({
  "user_3LeoBfUicTthDVixNbkPlqXFkdZ": "owner_lifetime",
  "user_3LfRV9oK9WP655tpVF3kavfwgtx": "founder_lifetime",
});

export function lifetimeAccessForOwner(ownerId: string): LifetimeAccess | null {
  return LIFETIME_ACCESS_BY_CLERK_ID[ownerId] ?? null;
}
