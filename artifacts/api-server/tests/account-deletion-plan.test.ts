import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountDeletionPlanError, planOwnedMediaDeletion } from "../src/lib/accountDeletionPlan";

const ownerA = "user_TestOwnerA";
const ownerB = "user_TestOwnerB";
const pathA = "/objects/uploads/11111111-1111-4111-8111-111111111111";
const pathB = "/objects/uploads/22222222-2222-4222-8222-222222222222";

test("empty owner plan does not touch any files", () => {
  assert.deepEqual(planOwnedMediaDeletion(ownerA, []), { ownerId: ownerA, objectPaths: [] });
});

test("deduplicates only the selected owner's private objects", () => {
  assert.deepEqual(planOwnedMediaDeletion(ownerA, [
    { ownerId: ownerA, objectPath: pathB },
    { ownerId: ownerA, objectPath: pathA },
    { ownerId: ownerA, objectPath: pathA },
  ]), { ownerId: ownerA, objectPaths: [pathA, pathB] });
});

test("rejects a mixed-owner batch atomically", () => {
  assert.throws(() => planOwnedMediaDeletion(ownerA, [
    { ownerId: ownerA, objectPath: pathA },
    { ownerId: ownerB, objectPath: pathB },
  ]), (error: unknown) => error instanceof AccountDeletionPlanError && error.message === "CROSS_OWNER_MEDIA");
});

test("rejects malformed paths and invalid owner ids", () => {
  assert.throws(() => planOwnedMediaDeletion(ownerA, [{ ownerId: ownerA, objectPath: "/objects/../../other" }]), /INVALID_MEDIA_PATH/);
  assert.throws(() => planOwnedMediaDeletion("", []), /INVALID_OWNER_ID/);
});

test("result is immutable and input remains unchanged", () => {
  const records = [{ ownerId: ownerA, objectPath: pathA }];
  const plan = planOwnedMediaDeletion(ownerA, records);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.objectPaths));
  assert.equal(records.length, 1);
});
