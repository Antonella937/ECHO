import test from "node:test";
import assert from "node:assert/strict";
import { chooseGroupSpeaker } from "../src/autonomy/group-policy";

test("automatic spectator scene rotates across all four characters", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const participants = ["a", "b", "c", "d"];
  const candidates = participants.map(id => ({ id, enabled: true, dmEnabled: true }));
  let lastSenderId: string | null = null;
  const speakers: string[] = [];
  for (let turn = 0; turn < 8; turn++) {
    const selected = chooseGroupSpeaker({
      enabled: true, globalKillSwitchEngaged: false, liveExecutionEnabled: true,
      intervalMinutes: 0, sceneMode: true, turnMode: "automatic",
      participantIds: participants, candidates, now, lastSenderId,
    });
    assert.ok(selected);
    speakers.push(selected);
    lastSenderId = selected;
  }
  assert.deepEqual(speakers, ["a", "b", "c", "d", "a", "b", "c", "d"]);
});

test("disabled characters are skipped without blocking other speakers", () => {
  const participants = ["a", "b", "c", "d"];
  const selected = chooseGroupSpeaker({
    enabled: true, globalKillSwitchEngaged: false, liveExecutionEnabled: true,
    intervalMinutes: 0, sceneMode: true, turnMode: "automatic",
    participantIds: participants,
    candidates: participants.map(id => ({ id, enabled: id !== "c", dmEnabled: true })),
    now: new Date("2026-11-10T12:00:00Z"), lastSenderId: "b",
  });
  assert.equal(selected, "d");
});
