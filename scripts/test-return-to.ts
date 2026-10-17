import assert from "node:assert/strict";
import { test } from "node:test";
import { loginPath, safeReturnTo } from "../src/modules/auth/return-to";

test("accepts same-origin paths with query", () => {
  assert.equal(safeReturnTo("/yonetim/urunler?page=3&sort=name"), "/yonetim/urunler?page=3&sort=name");
});

test("rejects external and malformed targets", () => {
  for (const value of ["//evil.com", "/\\evil.com", "https://evil.com", "evil", "", "/a\nb", null, undefined, ["/x"]]) {
    assert.equal(safeReturnTo(value), null, String(value));
  }
});

test("builds login paths that keep the return target", () => {
  assert.equal(loginPath("/yonetim?tab=a&b=1"), "/giris?next=%2Fyonetim%3Ftab%3Da%26b%3D1");
  assert.equal(loginPath("/yonetim", "1"), "/giris?error=1&next=%2Fyonetim");
  assert.equal(loginPath("//evil.com", "limit"), "/giris?error=limit");
  assert.equal(loginPath(null), "/giris");
  assert.equal(loginPath("/"), "/giris");
});
