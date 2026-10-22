import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../lib/auth/config.ts";

test("authentication return paths reject normalized external destinations and private endpoints", () => {
  for (const value of ["/\t/other.test", "/\r/other.test", "/\n/other.test", "/\\other.test", "//other.test", "https://other.test", "/inbox\u0000", "/inbox\u007f", "/inbox/../auth/callback", "/inbox/../api/crm", "/inbox/../login"]) {
    assert.equal(safeReturnPath(value), "/", JSON.stringify(value));
  }
  for (const value of ["/inbox", "/leads?search=water#details", "/settings"]) assert.equal(safeReturnPath(value), value);
  assert.equal(safeReturnPath(null), "/");
  assert.equal(safeReturnPath({ next: "/inbox" }), "/");
});
