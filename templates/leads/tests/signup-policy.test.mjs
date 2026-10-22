import test from "node:test";
import assert from "node:assert/strict";
import { immediateSignupPolicy } from "../lib/auth/signup-policy.ts";

test("immediate signup requires the configured no-confirmation policy before creating any account", async () => {
  const saved = { ...process.env }, seen = [];
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://isolated.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_isolated_test";
    const policy = async (value, status = 200) => immediateSignupPolicy(async (url, options) => {
      seen.push({ url, options });
      return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    });
    const settings = { disable_signup: false, external: { email: true }, mailer_autoconfirm: true };
    assert.equal(await policy(settings), "ready");
    assert.equal(await policy({ ...settings, mailer_autoconfirm: false }), "confirmation-required");
    assert.equal(await policy({ ...settings, disable_signup: true }), "disabled");
    assert.equal(await policy({ ...settings, external: { email: false } }), "disabled");
    assert.equal(await policy({}), "unavailable");
    assert.equal(await policy(settings, 503), "unavailable");
    assert.equal(await immediateSignupPolicy(async () => { throw new Error("Fake network failure"); }), "unavailable");
    for (const request of seen) {
      assert.equal(request.url, "https://isolated.supabase.co/auth/v1/settings");
      assert.equal(request.options.cache, "no-store");
      assert.equal(request.options.headers.apikey, "sb_publishable_isolated_test");
      assert.equal(request.options.body, undefined);
    }
  } finally { process.env = saved; }
});
