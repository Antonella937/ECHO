/** This build has no scheduler, executor, or route capable of live social writes. */
export const AUTONOMY_LIVE_EXECUTION_ENABLED = false as const;
export const DEFAULT_CHARACTER_CONTROL = {
  enabled: false,
  maxActionsPerDay: 2,
  minCooldownMinutes: 360,
};
