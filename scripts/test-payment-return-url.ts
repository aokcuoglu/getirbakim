import assert from "node:assert/strict";
import test from "node:test";

// TAMI's hosted page skips callbacks whose hostname has no dot (#743).
test("TAMI callback base: localhost is sent as 127.0.0.1 and handed back to localhost", async () => {
  process.env.TAMI_SECRET_KEY ||= "synthetic-test-secret";
  const { providerReturnBase, siteReturnUrl } = await import("../src/modules/payments/checkout");
  assert.equal(providerReturnBase("http://localhost:3000"), "http://127.0.0.1:3000");
  assert.equal(providerReturnBase("https://getirbakim.com"), "https://getirbakim.com");

  const local = new URL("http://127.0.0.1:3000/api/payments/tami/callback?order=o&sig=s");
  assert.equal(siteReturnUrl(local, "http://localhost:3000")?.toString(), "http://localhost:3000/api/payments/tami/callback?order=o&sig=s");
  assert.equal(siteReturnUrl(new URL("http://localhost:3000/api/payments/tami/callback?order=o"), "http://localhost:3000"), null);
  // Production never redirects, whatever host the proxy forwards.
  assert.equal(siteReturnUrl(new URL("http://10.0.0.5:3000/api/payments/tami/callback?order=o"), "https://getirbakim.com"), null);
});
