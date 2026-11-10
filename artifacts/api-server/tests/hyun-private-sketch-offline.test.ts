import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHyunPrivateSketchPrompt,
  canAttemptHyunPrivateSketch,
  privateSketchWithinLimits,
  shouldOfferHyunPrivateSketch,
} from "../src/autonomy/hyun-private-sketch-policy";

const scope = {
  ownerId: "user_3LeoBfUicTthDVixNbkPlqXFkdZ",
  senderHandle: "@hyunnn",
  recipientHandle: "@nela",
  channel: "dm" as const,
  explicitlyEnabled: true,
};

test("private sketches are limited to Hyun, Nela and their DM", () => {
  assert.equal(canAttemptHyunPrivateSketch(scope), true);
  assert.equal(canAttemptHyunPrivateSketch({ ...scope, recipientHandle: "mar" }), false);
  assert.equal(canAttemptHyunPrivateSketch({ ...scope, senderHandle: "noah" }), false);
  assert.equal(canAttemptHyunPrivateSketch({ ...scope, channel: "story" }), false);
  assert.equal(canAttemptHyunPrivateSketch({ ...scope, explicitlyEnabled: false }), false);
});

test("daily and monthly caps include already reserved attempts", () => {
  assert.equal(privateSketchWithinLimits(2, 0), true);
  assert.equal(privateSketchWithinLimits(3, 0), false);
  assert.equal(privateSketchWithinLimits(0, 1), false);
});

test("never sends a sketch on direct replies or outside low-frequency draw", () => {
  const base = { scope, isUnsolicited: true, alreadyHasImage: false,
    monthlyAttempts: 0, dailyAttempts: 0, random: 0.04 };
  assert.equal(shouldOfferHyunPrivateSketch(base), true);
  assert.equal(shouldOfferHyunPrivateSketch({ ...base, isUnsolicited: false }), false);
  assert.equal(shouldOfferHyunPrivateSketch({ ...base, random: 0.5 }), false);
  assert.equal(shouldOfferHyunPrivateSketch({ ...base, alreadyHasImage: true }), false);
});

test("sketch prompt describes unfinished physical artwork", () => {
  const prompt = buildHyunPrivateSketchPrompt("night city");
  assert.match(prompt, /unfinished/);
  assert.match(prompt, /night city/);
  assert.throws(() => buildHyunPrivateSketchPrompt(" "), /INVALID_PRIVATE_SKETCH_SUBJECT/);
});
