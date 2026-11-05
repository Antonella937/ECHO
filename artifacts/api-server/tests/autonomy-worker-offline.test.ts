import test from "node:test";
import assert from "node:assert/strict";
import { runAutonomyWorkerTick, startAutonomyWorker, AUTONOMY_WORKER_INTERVAL_MS } from "../src/autonomy/worker";

test("disabled autonomy never reads targets or acquires a lease", async () => {
  let touched = false;
  const result = await runAutonomyWorkerTick({
    enabled: false,
    repository: {
      listLiveOptInTargets: async () => { touched = true; return []; },
      claimWorkerLease: async () => { touched = true; return true; },
      releaseWorkerLease: async () => { touched = true; },
    },
    processCharacter: async () => { touched = true; return { status: "executed" }; },
  });
  assert.equal(result.status, "disabled");
  assert.equal(touched, false);
});

test("worker uses stable keys, handles target failures, and releases lease", async () => {
  const keys: string[] = [];
  const released: string[] = [];
  const repository = {
    listLiveOptInTargets: async () => [
      { ownerId: "alice", universeId: "primary", characterId: "mar" },
      { ownerId: "alice", universeId: "primary", characterId: "noah" },
      { ownerId: "bob", universeId: "studio", characterId: "dante" },
    ],
    claimWorkerLease: async () => true,
    releaseWorkerLease: async (token: string) => { released.push(token); },
  };
  const run = () => runAutonomyWorkerTick({
    enabled: true, repository, now: new Date("2026-11-05T12:00:00Z"),
    tokenFactory: () => "offline-token",
    processCharacter: async (_ownerId, input) => {
      keys.push(input.idempotencyKey);
      if (input.characterId === "dante") throw new Error("synthetic failure");
      return { status: input.characterId === "mar" ? "executed" : "no_action" };
    },
  });
  const first = await run();
  assert.deepEqual(first, { status: "completed", evaluated: 3, executed: 1, noAction: 1, failed: 1 });
  const firstKeys = keys.slice();
  keys.length = 0;
  await run();
  assert.deepEqual(keys, firstKeys);
  assert.equal(new Set(firstKeys).size, 3);
  assert.deepEqual(released, ["offline-token", "offline-token"]);
});

test("worker refuses concurrent ticks and respects stop", async () => {
  let callback: (() => void) | undefined;
  let resolveFirst: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { resolveFirst = resolve; });
  let count = 0;
  const scheduler = startAutonomyWorker({
    enabled: true, intervalMs: AUTONOMY_WORKER_INTERVAL_MS,
    tick: async () => {
      count++;
      if (count === 1) await pending;
      return { status: "completed", evaluated: 0, executed: 0, noAction: 0, failed: 0 };
    },
    setIntervalFn: ((cb: () => void) => { callback = cb; return { unref() {} }; }) as typeof setInterval,
    clearIntervalFn: (() => undefined) as typeof clearInterval,
  });
  assert.ok(callback);
  callback();
  await new Promise<void>(resolve => setImmediate(resolve));
  callback();
  assert.equal(count, 1);
  resolveFirst!();
  await new Promise<void>(resolve => setImmediate(resolve));
  callback();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(count, 2);
  scheduler.stop();
  callback();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(count, 2);
});
