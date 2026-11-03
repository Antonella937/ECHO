import { createHash, randomUUID } from "node:crypto";

export const AUTONOMY_WORKER_INTERVAL_MS = 30 * 60_000;
const WORKER_LEASE_MS = 10 * 60_000;

export interface AutonomyWorkerTarget {
  ownerId: string;
  characterId: string;
}

export interface AutonomyWorkerRepository {
  listLiveOptInTargets(): Promise<AutonomyWorkerTarget[]>;
  claimWorkerLease(token: string, now: Date, ttlMs: number): Promise<boolean>;
  releaseWorkerLease(token: string): Promise<void>;
}

export interface AutonomyWorkerResult {
  status: "disabled" | "busy" | "completed";
  evaluated: number;
  executed: number;
  noAction: number;
  failed: number;
}

function safeErrorCode(error: unknown) {
  return error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
    ? error.message : "WORKER_TICK_FAILED";
}

export async function runAutonomyWorkerTick(input: {
  enabled: boolean;
  repository: AutonomyWorkerRepository;
  processCharacter: (
    ownerId: string,
    input: { characterId: string; idempotencyKey: string },
    now: Date,
  ) => Promise<{ status: string }>;
  now?: Date;
  tokenFactory?: () => string;
}): Promise<AutonomyWorkerResult> {
  if (!input.enabled) return { status: "disabled", evaluated: 0, executed: 0, noAction: 0, failed: 0 };
  const now = input.now ?? new Date();
  const token = (input.tokenFactory ?? randomUUID)();
  const claimed = await input.repository.claimWorkerLease(token, now, WORKER_LEASE_MS);
  if (!claimed) return { status: "busy", evaluated: 0, executed: 0, noAction: 0, failed: 0 };
  let evaluated = 0;
  let executed = 0;
  let noAction = 0;
  let failed = 0;
  try {
    const targets = await input.repository.listLiveOptInTargets();
    const slot = Math.floor(now.getTime() / AUTONOMY_WORKER_INTERVAL_MS);
    for (const target of targets) {
      const characterHash = createHash("sha256").update(target.characterId).digest("hex").slice(0, 24);
      const idempotencyKey = `worker:${slot}:${characterHash}`;
      evaluated += 1;
      try {
        const result = await input.processCharacter(
          target.ownerId, { characterId: target.characterId, idempotencyKey }, now,
        );
        if (result.status === "executed") executed += 1;
        else if (result.status === "no_action" || result.status === "disabled" ||
          result.status === "rate_limited" || result.status === "duplicate" ||
          result.status === "in_progress") noAction += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { status: "completed", evaluated, executed, noAction, failed };
  } finally {
    await input.repository.releaseWorkerLease(token).catch(() => undefined);
  }
}

export function startAutonomyWorker(input: {
  enabled: boolean;
  tick: () => Promise<AutonomyWorkerResult>;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  onError?: (code: string) => void;
}): { started: boolean; stop: () => void } {
  if (!input.enabled) return { started: false, stop: () => undefined };
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  const handle = setIntervalFn(() => {
    void input.tick().catch((error) => input.onError?.(safeErrorCode(error)));
  }, input.intervalMs ?? AUTONOMY_WORKER_INTERVAL_MS);
  handle.unref?.();
  return { started: true, stop: () => clearIntervalFn(handle) };
}
