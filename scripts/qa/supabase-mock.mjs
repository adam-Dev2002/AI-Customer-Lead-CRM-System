// Isolated QA HTTP service, never imported by application code or used with real credentials.
import { createServer } from "node:http";
import { randomUUID, createHmac } from "node:crypto";

export async function startSupabaseMock() {
  const key = "sb_publishable_isolated_qa_only", secret = randomUUID(), tokens = new Map();
  const owner = { id: "11111111-1111-4111-8111-111111111111", email: "owner.qa@example.com" };
  const outsider = { id: "22222222-2222-4222-8222-222222222222", email: "outsider.qa@example.com" };
  const member = { id: "33333333-3333-4333-8333-333333333333", email: "member.qa@example.com" };
  const password = "isolated-qa-password";
  let ownerAccess = true;
  const userObject = user => ({ ...user, aud: "authenticated", role: "authenticated", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
  const token = user => {
    const encode = object => Buffer.from(JSON.stringify(object)).toString("base64url");
    const value = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), aud: "authenticated", role: "authenticated" })}`;
    const signed = value + "." + createHmac("sha256", secret).update(value).digest("base64url");
    tokens.set(signed, user); return signed;
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const send = (body, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.headers.apikey !== key) return send({ message: "Invalid QA key" }, 401);
    const user = tokens.get(request.headers.authorization?.replace(/^Bearer /, ""));
    if (url.pathname === "/auth/v1/settings") return send({ external: { email: true }, disable_signup: true });
    if (url.pathname === "/auth/v1/token" && request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const account = [owner, outsider, member].find(item => item.email === body.email);
      if (!account || body.password !== password) return send({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
      return send({ access_token: token(account), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "qa-refresh-" + randomUUID(), user: userObject(account) });
    }
    if (url.pathname === "/auth/v1/user") return user ? send(userObject(user)) : send({ msg: "Invalid token", code: 401 }, 401);
    if (url.pathname === "/auth/v1/logout") { response.writeHead(204); return response.end(); }
    if (url.pathname === "/auth/v1/recover") return send({});
    if (url.pathname === "/rest/v1/crm_workspace_members") {
      if (ownerAccess && user?.id === owner.id && url.searchParams.get("user_id") === `eq.${owner.id}`) return send([{ user_id: owner.id, role: "owner", display_name: "QA Owner" }]);
      if (user?.id === member.id && url.searchParams.get("user_id") === `eq.${member.id}`) return send([{ user_id: member.id, role: "member", display_name: "QA Member" }]);
      return send([]);
    }
    return send({ message: "Unknown QA route" }, 404);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, key, owner, outsider, member, password, setOwnerAccess: value => { ownerAccess = value; }, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
