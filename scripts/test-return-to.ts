import assert from "node:assert/strict";
import { test } from "node:test";
import { returnTarget } from "../src/components/auth/return-target";
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

test("auth forms return to the explicit next, the login page's next, or the current page", () => {
  assert.equal(returnTarget("/sepet", "/urunler", "?a=1"), "/sepet");
  assert.equal(returnTarget(undefined, "/urunler/x", "?a=1"), "/urunler/x?a=1");
  assert.equal(returnTarget(undefined, "/giris", "?next=%2Fsepet"), "/sepet");
  assert.equal(returnTarget(undefined, "/giris", "?next=%2F%2Fevil.com"), "/");
  assert.equal(returnTarget(undefined, "/giris", ""), "/");
});
