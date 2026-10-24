import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../lib/auth/config.ts";
import { customerPageRedirect, customerSiteOrigin } from "../lib/auth/customer-site.ts";

test("previous public login addresses redirect to the selected CRM with path and query preserved", () => {
  for (const host of ['ai-customer-lead-crm-system.vercel.app', 'ai-customer-lead-crm-system-1hmk.vercel.app']) {
    const current = new URL('http://localhost:3001/login?next=%2Finbox');
    assert.equal(customerPageRedirect(current, host)?.href, customerSiteOrigin + '/login?next=%2Finbox');
    assert.equal(customerPageRedirect(new URL('https://' + host + '/connections'), null, 'HEAD')?.href, customerSiteOrigin + '/connections');
  }
});

test("customer redirects leave local/custom/current sites and API mutations alone and cannot change the target host", () => {
  const current = new URL('http://localhost:3001/login?next=https%3A%2F%2Foutside.test');
  const old = 'ai-customer-lead-crm-system.vercel.app';
  for (const host of ['localhost:3001', '127.0.0.1:3001', new URL(customerSiteOrigin).host, 'support.example.com', old + '.outside.test', 'user@' + old, old + '/other', old + '?x=1']) assert.equal(customerPageRedirect(current, host), null, host);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(customerPageRedirect(current, old, method), null);
  for (const pathname of ['/api/auth', '/api/n8n/mail', '/_next/static/example.js']) assert.equal(customerPageRedirect(new URL('http://localhost' + pathname), old), null);
  const crafted = new URL('https://' + old); crafted.pathname = '//outside.test/login';
  assert.equal(customerPageRedirect(crafted, old)?.origin, customerSiteOrigin);
  assert.equal(safeReturnPath(customerPageRedirect(current, old).searchParams.get('next')), '/');
});

test("authentication return paths reject normalized external destinations and private endpoints", () => {
  for (const value of ["/\t/other.test", "/\r/other.test", "/\n/other.test", "/\\other.test", "//other.test", "https://other.test", "/inbox\u0000", "/inbox\u007f", "/inbox/../auth/callback", "/inbox/../api/crm", "/inbox/../login"]) {
    assert.equal(safeReturnPath(value), "/", JSON.stringify(value));
  }
  for (const value of ["/inbox", "/leads?search=water#details", "/settings"]) assert.equal(safeReturnPath(value), value);
  assert.equal(safeReturnPath(null), "/");
  assert.equal(safeReturnPath({ next: "/inbox" }), "/");
});
