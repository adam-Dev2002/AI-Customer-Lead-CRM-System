// Isolated QA HTTP service, never imported by application code or used with real credentials.
import { createServer } from "node:http";
import { randomUUID, createHmac } from "node:crypto";

export async function startSupabaseMock(options = {}) {
  const key = "sb_publishable_isolated_qa_only", secret = randomUUID(), tokens = new Map();
  const owner = { id: "11111111-1111-4111-8111-111111111111", email: "owner.qa@example.com" };
  const outsider = { id: "22222222-2222-4222-8222-222222222222", email: "outsider.qa@example.com" };
  const member = { id: "33333333-3333-4333-8333-333333333333", email: "member.qa@example.com" };
  const password = "isolated-qa-password";
  const accounts = [owner, outsider, member], passwords = new Map(accounts.map(account => [account.email, password])), confirmations = new Map();
  let ownerAccess = true;
  const control = { signupFailure: null, resetFailure: null, emailAutoConfirm: options.emailAutoConfirm === true, signupRequests: 0, confirmationEmails: 0 };
  const userObject = user => ({ ...user, aud: "authenticated", role: "authenticated", email_confirmed_at: user.confirmed === false ? null : "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: user.user_metadata || {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
  async function confirmSignup(email) {
    const account = accounts.find(item => item.email === email);
    if (!account) throw new Error("Unknown isolated QA signup.");
    account.confirmed = true;
    await options.onConfirmed?.(userObject(account));
    return userObject(account);
  }
  const token = user => {
    const encode = object => Buffer.from(JSON.stringify(object)).toString("base64url");
    const value = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), aud: "authenticated", role: "authenticated" })}`;
    const signed = value + "." + createHmac("sha256", secret).update(value).digest("base64url");
    tokens.set(signed, user); return signed;
  };
  const server = createServer(async (request, response) => {
    try {
    const url = new URL(request.url, "http://127.0.0.1");
    const send = (body, status = 200) => { response.writeHead(status, { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" }); response.end(JSON.stringify(body)); };
    if (request.headers.apikey !== key) return send({ message: "Invalid QA key" }, 401);
    const user = tokens.get(request.headers.authorization?.replace(/^Bearer /, ""));
    const readBody = async () => { let raw = ""; for await (const chunk of request) raw += chunk; return JSON.parse(raw || "{}"); };
    if (url.pathname === "/auth/v1/settings") return send({ external: { email: true }, disable_signup: !options.signupEnabled, mailer_autoconfirm: control.emailAutoConfirm });
    if (url.pathname === "/auth/v1/signup" && request.method === "POST") {
      control.signupRequests++;
      if (control.signupFailure) return send({ msg: "Simulated signup service failure", code: control.signupFailure.code }, control.signupFailure.status);
      if (!options.signupEnabled) return send({ msg: "Signups not allowed", code: "signup_disabled" }, 422);
      const body = await readBody();
      const existing = accounts.find(item => item.email === body.email);
      if (existing) return control.emailAutoConfirm ? send({ msg: "User already registered", code: "user_already_exists" }, 422) : send({ ...userObject(existing), identities: [] });
      const account = { id: randomUUID(), email: body.email, confirmed: control.emailAutoConfirm, user_metadata: body.data || {} };
      accounts.push(account); passwords.set(account.email, body.password);
      if (!control.emailAutoConfirm) { confirmations.set(randomUUID(), account.email); control.confirmationEmails++; }
      await options.onSignup?.(userObject(account));
      return control.emailAutoConfirm ? send({ access_token: token(account), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "qa-refresh-" + randomUUID(), user: userObject(account) }) : send(userObject(account));
    }
    if (url.pathname === "/auth/v1/verify" && request.method === "POST") {
      const body = await readBody(), email = confirmations.get(body.token_hash);
      if (!email || body.type !== "signup") return send({ msg: "Token expired", code: "otp_expired" }, 403);
      confirmations.delete(body.token_hash);
      const account = accounts.find(item => item.email === email);
      await confirmSignup(email);
      return send({ access_token: token(account), token_type: "bearer", expires_in: 3600, refresh_token: "qa-refresh-" + randomUUID(), user: userObject(account) });
    }
    if (url.pathname === "/auth/v1/token" && request.method === "POST") {
      const body = await readBody();
      const account = accounts.find(item => item.email === body.email);
      if (!account || body.password !== passwords.get(account.email)) return send({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
      if (account.confirmed === false) return send({ error: "invalid_grant", error_description: "Email not confirmed", code: "email_not_confirmed" }, 400);
      return send({ access_token: token(account), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "qa-refresh-" + randomUUID(), user: userObject(account) });
    }
    if (url.pathname === "/auth/v1/user") return user ? send(userObject(user)) : send({ msg: "Invalid token", code: 401 }, 401);
    if (url.pathname === "/auth/v1/logout") { tokens.delete(request.headers.authorization?.replace(/^Bearer /, "")); response.writeHead(204); return response.end(); }
    if (url.pathname === "/auth/v1/recover") return control.resetFailure ? send({ msg: "Simulated reset email failure", code: control.resetFailure.code }, control.resetFailure.status) : send({});
    if (url.pathname === "/rest/v1/crm_workspace_members") {
      if (options.resolveMembership) return send(user && url.searchParams.get("user_id") === `eq.${user.id}` ? await options.resolveMembership(userObject(user)) : []);
      if (ownerAccess && user?.id === owner.id && url.searchParams.get("user_id") === `eq.${owner.id}`) return send([{ user_id: owner.id, workspace_id: "clearflow", role: "owner", display_name: "QA Owner" }]);
      if (user?.id === member.id && url.searchParams.get("user_id") === `eq.${member.id}`) return send([{ user_id: member.id, workspace_id: "clearflow", role: "member", display_name: "QA Member" }]);
      return send([]);
    }
    return send({ message: "Unknown QA route" }, 404);
    } catch { response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ message: "Isolated QA Auth failure" })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, key, owner, outsider, member, password, accounts, control, confirmationToken: email => [...confirmations].find(([, accountEmail]) => accountEmail === email)?.[0], confirmSignup, setOwnerAccess: value => { ownerAccess = value; }, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
