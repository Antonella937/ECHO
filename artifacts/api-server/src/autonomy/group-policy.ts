/** Group autonomy remains opt-in. No AI calls are made by this module. */
export interface GroupAutonomyCandidate {
  id: string;
  archived?: boolean;
  enabled: boolean;
  dmEnabled: boolean;
  lastActionAt?: Date | string | null;
  timezone?: string;
  sleeping?: boolean;
}
export interface GroupAutonomyPolicyInput {
  enabled: boolean;
  globalKillSwitchEngaged: boolean;
  liveExecutionEnabled: boolean;
  intervalMinutes: number;
  lastGroupActionAt?: Date | string | null;
  participantIds: string[];
  candidates: GroupAutonomyCandidate[];
  now: Date;
}
const asTime = (value?: Date | string | null) => value ? new Date(value).getTime() : NaN;
export function eligibleGroupSpeakers(input: GroupAutonomyPolicyInput): string[] {
  if (!input.enabled || input.globalKillSwitchEngaged || !input.liveExecutionEnabled) return [];
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 15 || input.intervalMinutes > 1440) return [];
  const groupLast = asTime(input.lastGroupActionAt);
  if (Number.isFinite(groupLast) && input.now.getTime() - groupLast < input.intervalMinutes * 60_000) return [];
  const members = new Set(input.participantIds);
  return input.candidates.filter(c => {
    if (!members.has(c.id) || c.archived || !c.enabled || !c.dmEnabled || c.sleeping) return false;
    const last = asTime(c.lastActionAt);
    return !Number.isFinite(last) || input.now.getTime() - last >= 15 * 60_000;
  }).map(c => c.id);
}
