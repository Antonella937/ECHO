import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupportAdmin, validSupportSubmission, validSupportUpdate } from "../src/lib/supportPolicy";

test("accepts supported ticket categories and rejects invalid descriptions", () => {
  assert.equal(validSupportSubmission({ category: "technical", description: "Error al guardar" }), true);
  assert.equal(validSupportSubmission({ category: "other", area: "Mensajes", description: "Falló" }), true);
  assert.equal(validSupportSubmission({ category: "unknown", description: "Falló" }), false);
  assert.equal(validSupportSubmission({ category: "technical", description: "   " }), false);
  assert.equal(validSupportSubmission({ category: "technical", description: "x".repeat(4001) }), false);
  assert.equal(validSupportSubmission({ category: "technical", description: "ok", area: "x".repeat(121) }), false);
  assert.equal(validSupportSubmission(null), false);
});

test("accepts only valid moderation updates", () => {
  assert.equal(validSupportUpdate({ status: "investigating", adminNote: "Revisando" }), true);
  assert.equal(validSupportUpdate({ status: "closed" }), true);
  assert.equal(validSupportUpdate({ status: "deleted" }), false);
  assert.equal(validSupportUpdate({ status: "open", adminNote: "x".repeat(2001) }), false);
  assert.equal(validSupportUpdate({ status: "open", adminNote: 5 }), false);
});

test("admin access fails closed without exact Clerk user ID", () => {
  assert.equal(isSupportAdmin("user_ABC123", "user_ABC123,user_DEF456"), true);
  assert.equal(isSupportAdmin("user_ABC123", "user_ABC1234"), false);
  assert.equal(isSupportAdmin("user_ABC123", undefined), false);
  assert.equal(isSupportAdmin(null, "user_ABC123"), false);
  assert.equal(isSupportAdmin("someone@example.com", "someone@example.com"), false);
});

// TODO: separate integration tests with Clerk auth and a disposable Postgres database
// must prove account isolation and 401/403/404 behavior before deployment.
