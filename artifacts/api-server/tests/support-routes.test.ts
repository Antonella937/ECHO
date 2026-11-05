import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { getAuth } from "@clerk/express";
import supportRouter from "../src/routes/support";

// These integration tests need an authenticated Clerk test harness and a dedicated test DB.
// Until available, keep this file as a test plan rather than a misleading passing test.
test.skip("unauthenticated user cannot create or list tickets", () => {
  assert.ok(express && getAuth && supportRouter);
});
test.skip("user A cannot list user B tickets", () => {});
test.skip("non-admin cannot read or modify admin tickets", () => {});
test.skip("admin can change ticket status without changing ownership", () => {});
test.skip("invalid category, description and status are rejected", () => {});
