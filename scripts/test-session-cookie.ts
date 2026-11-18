import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { RETURN_TO_HEADER } from "@/modules/auth/return-to";
import { SESSION_COOKIE, SESSION_IDLE_SECONDS, SESSION_REFRESH_SECONDS, SESSION_SEEN_COOKIE, sessionCookieDue, sessionCookieOptions } from "@/modules/auth/session-cookie";

const token = "a".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const request = (path: string, cookie?: string, init?: { method?: string; headers?: Record<string, string> }) =>
  new NextRequest(new URL(path, "https://shop.example.invalid"), { method: init?.method, headers: { ...init?.headers, ...(cookie ? { cookie } : {}) } });
const setCookies = (response: Response) => response.headers.getSetCookie();

test("the cookie is due without a usable stamp or after the refresh interval", () => {
  const t = 1_800_000_000;
  assert.equal(sessionCookieDue(undefined, t), true);
  assert.equal(sessionCookieDue("", t), true);
  assert.equal(sessionCookieDue("abc", t), true);
  assert.equal(sessionCookieDue("-5", t), true);
  assert.equal(sessionCookieDue("1.5", t), true);
  assert.equal(sessionCookieDue(String(t + 1), t), true);
  assert.equal(sessionCookieDue(String(t), t), false);
  assert.equal(sessionCookieDue(String(t - SESSION_REFRESH_SECONDS + 1), t), false);
  assert.equal(sessionCookieDue(String(t - SESSION_REFRESH_SECONDS), t), true);
});

test("a skipped refresh never lets the cookie die before the database session", () => {
  assert.ok(sessionCookieOptions().maxAge - SESSION_REFRESH_SECONDS >= SESSION_IDLE_SECONDS);
});

test("the proxy writes no cookie for a visitor without a session", () => {
  assert.deepEqual(setCookies(proxy(request("/sepet"))), []);
});

test("a session without a stamp gets both cookies with the session lifetime", () => {
  const cookies = setCookies(proxy(request("/sepet", `${SESSION_COOKIE}=${token}`)));
  assert.equal(cookies.length, 2);
  const session = cookies.find(c => c.startsWith(`${SESSION_COOKIE}=`));
  const seen = cookies.find(c => c.startsWith(`${SESSION_SEEN_COOKIE}=`));
  assert.ok(session?.startsWith(`${SESSION_COOKIE}=${token};`));
  for (const cookie of [session, seen]) {
    assert.match(cookie ?? "", new RegExp(`Max-Age=${SESSION_IDLE_SECONDS + SESSION_REFRESH_SECONDS}`));
    assert.match(cookie ?? "", /HttpOnly/i);
    assert.match(cookie ?? "", /SameSite=lax/i);
    assert.match(cookie ?? "", /Path=\//);
  }
  const stamp = Number(/^gb_session_at=(\d+);/.exec(seen ?? "")?.[1]);
  assert.ok(Math.abs(stamp - now()) <= 2);
});

test("a server action with a fresh stamp gets no Set-Cookie (#716)", () => {
  const response = proxy(request("/urun/x", `${SESSION_COOKIE}=${token}; ${SESSION_SEEN_COOKIE}=${now() - 10}`, { method: "POST", headers: { "next-action": "00", "content-type": "text/plain;charset=UTF-8" } }));
  assert.deepEqual(setCookies(response), []);
});

test("an old stamp rewrites both cookies and /yonetim keeps its return address", () => {
  const response = proxy(request("/yonetim/urunler?page=2&_rsc=1", `${SESSION_COOKIE}=${token}; ${SESSION_SEEN_COOKIE}=${now() - SESSION_REFRESH_SECONDS}`));
  const cookies = setCookies(response);
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some(c => c.startsWith(`${SESSION_COOKIE}=${token};`)));
  assert.ok(cookies.some(c => c.startsWith(`${SESSION_SEEN_COOKIE}=`)));
  assert.equal(response.headers.get(`x-middleware-request-${RETURN_TO_HEADER}`), "/yonetim/urunler?page=2");
});

test("publicly cached routes never get the session cookie (#642)", () => {
  const cookies = { [SESSION_COOKIE]: token };
  for (const url of ["/api/categories", "/api/category-media/9db4f695-185e-4d35-b8e4-190bfb549e91", "/api/product-media/175b52d1-f7be-4e67-8b8c-7b6bfa6f23dd",
    "/api/product-fitments/175b52d1-f7be-4e67-8b8c-7b6bfa6f23dd", "/api/product-fitments/175b52d1-f7be-4e67-8b8c-7b6bfa6f23dd?v=abc", "/feeds/google.xml.gz"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url, cookies }), false, `${url} runs the proxy`);
    assert.deepEqual(setCookies(proxy(request(url, `${SESSION_COOKIE}=${token}`))), [], `${url} sets a cookie`);
  }
  // Neighbours still slide the session.
  for (const url of ["/api/categories-extra", "/api/product-fitments-x", "/api/vehicles", "/sepet", "/feedsx"]) assert.equal(unstable_doesMiddlewareMatch({ config, url, cookies }), true, url);
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/api/categories" }), false);
});
