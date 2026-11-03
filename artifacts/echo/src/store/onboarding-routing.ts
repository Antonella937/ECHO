/** New-user setup must never intercept a remote universe or recoverable local history. */
export function shouldShowCreatorOnboarding(
  hasRemoteUniverse: boolean,
  hasLegacyOrRecoveryData: boolean,
): boolean {
  return !hasRemoteUniverse && !hasLegacyOrRecoveryData;
}
