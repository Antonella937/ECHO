import { createHash, randomUUID } from "node:crypto";

export const AUTONOMY_WORKER_INTERVAL_MS = 2 * 60_000;
const WORKER_LEASE_MS = 10 * 60_000;
const SOCIAL_INTERVAL_MS = 30 * 60_000;
const CHARACTER_TIMEOUT_MS = 45_000;

// A stalled provider must not block all other characters indefinitely.
// The original operation may still settle; reservation/idempotency protects
// against duplicate actions when the next worker cycle retries.
async function boundedCharacterRun<T>(run: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("AUTONOMY_CHARACTER_TIMEOUT")), CHARACTER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface AutonomyWorkerTarget {
  ownerId: string;
  universeId: string;
  characterId: string;
  socialEnabled?: boolean;
  dmEnabled?: boolean;
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
  socialTickDue?: boolean;
  repository: AutonomyWorkerRepository;
  processCharacter: (
    ownerId: string,
    input: { universeId: string; characterId: string; idempotencyKey: string; lane?: "dm" | "social" },
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
    const socialSlot = Math.floor(now.getTime() / SOCIAL_INTERVAL_MS);
    for (const target of targets) {
      if (target.dmEnabled === false) continue;
      const characterHash = createHash("sha256").update(`${target.ownerId}:${target.universeId}:${target.characterId}`).digest("hex").slice(0, 24);
      const lane: "dm" | "social" = "dm";
      const digest = createHash("sha256").update(`dm:${slot}:${characterHash}`).digest("hex");
      // Deterministic RFC 4122 UUID: the API requires UUID keys, including worker runs.
      const idempotencyKey = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      evaluated += 1;
      try {
        const result = await boundedCharacterRun(() => input.processCharacter(
          target.ownerId, { universeId: target.universeId, characterId: target.characterId, idempotencyKey, lane }, now,
        ));
        if (result.status === "executed") executed += 1;
        else if (result.status === "no_action" || result.status === "disabled" ||
          result.status === "rate_limited" || result.status === "duplicate" ||
          result.status === "in_progress") noAction += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    // Spontaneous activity retains its slower cadence and separate idempotency namespace.
    if (input.socialTickDue ?? (slot % (SOCIAL_INTERVAL_MS / AUTONOMY_WORKER_INTERVAL_MS) === 0)) {
      for (const target of targets) {
        if (target.socialEnabled === false) continue;
        const hash = createHash("sha256").update(`social:${socialSlot}:${target.ownerId}:${target.universeId}:${target.characterId}`).digest("hex");
        const idempotencyKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        evaluated++;
        try {
          const result = await boundedCharacterRun(() => input.processCharacter(target.ownerId, { universeId: target.universeId, characterId: target.characterId, idempotencyKey, lane: "social" }, now));
          if (result.status === "executed") executed++;
          else if (result.status === "failed") failed++;
          else noAction++;
        } catch { failed++; }
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
  // Never overlap ticks within a process, even if a tick outlasts its interval.
  // The database lease independently prevents overlapping across processes.
  let running = false;
  let stopped = false;
  const runTick = () => {
    if (stopped || running) return;
    running = true;
    void Promise.resolve().then(() => input.tick())
      .catch((error) => input.onError?.(safeErrorCode(error)))
      .finally(() => { running = false; });
  };
  // Evaluate once at startup; otherwise every deployment postpones the first check.
  queueMicrotask(runTick);
  const handle = setIntervalFn(runTick, input.intervalMs ?? AUTONOMY_WORKER_INTERVAL_MS);
  handle.unref?.();
  return { started: true, stop: () => { stopped = true; clearIntervalFn(handle); } };
}
