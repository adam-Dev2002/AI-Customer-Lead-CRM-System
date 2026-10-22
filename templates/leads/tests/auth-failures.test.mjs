import test from "node:test";
import assert from "node:assert/strict";
import { authFailureMessage, authProviderFailure } from "../lib/auth/failures.ts";
import { sharedLimitResult } from "../lib/auth/rate-limit.ts";

test("signup and reset failures explain the action and never promise a confirmation email", () => {
  assert.equal(authProviderFailure({ code: "email_address_not_authorized", status: 403 }), "AUTH_EMAIL_SETUP");
  assert.equal(authProviderFailure({ code: "signup_disabled", status: 422 }), "AUTH_SIGNUP_DISABLED");
  assert.equal(authProviderFailure({ status: 429 }), "AUTH_RATE_LIMIT");
  assert.equal(authProviderFailure({ code: "weak_password", status: 422 }), "AUTH_WEAK_PASSWORD");
  assert.equal(authProviderFailure({ status: 500 }), "AUTH_UNAVAILABLE");
  assert.match(authFailureMessage("signup", "AUTH_UNAVAILABLE"), /create your account/);
  assert.match(authFailureMessage("reset", "AUTH_EMAIL_SETUP"), /Password reset emails are not available/);
  assert.match(authFailureMessage("signup", "AUTH_EMAIL_SETUP"), /confirmation emails are not available/);
  assert.doesNotMatch(authFailureMessage("signup", "AUTH_UNAVAILABLE"), /[Ss]ign.in/);
});

test("unconfigured Vercel storage is unavailable rather than a login throttle or thrown exception", async () => {
  const saved = { ...process.env };
  try {
    process.env.VERCEL = "1"; process.env.CRM_STORAGE_BACKEND = "local";
    assert.equal(await sharedLimitResult("auth-failure-qa", 1, 60000), "unavailable");
    delete process.env.VERCEL;
    assert.equal(await sharedLimitResult("auth-failure-qa", 1, 60000), "allowed");
    assert.equal(await sharedLimitResult("auth-failure-qa", 1, 60000), "limited");
  } finally { process.env = saved; }
});
