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
  sceneMode?: boolean;
  turnMode?: 'automatic' | 'round_robin' | 'manual';
  lastGroupActionAt?: Date | string | null;
  participantIds: string[];
  candidates: GroupAutonomyCandidate[];
  now: Date;
}
const asTime = (value?: Date | string | null) => value ? new Date(value).getTime() : NaN;
export function eligibleGroupSpeakers(input: GroupAutonomyPolicyInput): string[] {
  if (!input.enabled || input.globalKillSwitchEngaged || !input.liveExecutionEnabled) return [];
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < (input.sceneMode ? 0 : 15) || input.intervalMinutes > 1440) return [];
  const groupLast = asTime(input.lastGroupActionAt);
  if (Number.isFinite(groupLast) && input.now.getTime() - groupLast < input.intervalMinutes * 60_000) return [];
  const members = new Set(input.participantIds);
  return input.candidates.filter(c => {
    if (!members.has(c.id) || c.archived || !c.enabled || !c.dmEnabled || c.sleeping) return false;
    const last = asTime(c.lastActionAt);
    return input.sceneMode || !Number.isFinite(last) || input.now.getTime() - last >= 15 * 60_000;
  }).map(c => c.id);
}

/** One response maximum per evaluation, preferring a speaker other than the last sender.
 * This is deliberately deterministic to make retries idempotent at the scheduler boundary.
 */
export function chooseGroupSpeaker(input: GroupAutonomyPolicyInput & {
  lastSenderId?: string | null;
  lastMessageAt?: Date | string | null;
  lastMessageText?: string | null;
}): string | null {
  const eligible = eligibleGroupSpeakers(input);
  if (!eligible.length) return null;
  const lastAt = asTime(input.lastMessageAt);
  if (!input.sceneMode && (!Number.isFinite(lastAt) || lastAt > input.now.getTime() ||
      input.now.getTime() - lastAt > 24 * 60 * 60_000 ||
      !input.lastMessageText?.trim())) return null;
  // Do not react immediately; let human participants finish typing.
  if (!input.sceneMode && input.now.getTime() - lastAt < 2 * 60_000) return null;
  if (input.turnMode === 'manual') return null;
  if (input.turnMode === 'round_robin') {
    const index = eligible.indexOf(input.lastSenderId ?? '');
    return eligible[(index + 1) % eligible.length] ?? null;
  }
  return eligible.find(id => id !== input.lastSenderId) ?? eligible[0] ?? null;
}
