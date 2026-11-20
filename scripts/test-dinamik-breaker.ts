import assert from "node:assert/strict";
import { test } from "node:test";
import { DINAMIK_UPSTREAM_FAILURE_LIMIT, nextDinamikBreaker, type DinamikBrandOutcome } from "../src/modules/suppliers/dinamik-breaker";

const ok: DinamikBrandOutcome = { ok: true };
const http500: DinamikBrandOutcome = { ok: false, reason: "upstream", detail: "getStockList HTTP 500" };
// importDinamik rethrows a TimeoutError or a socket error as upstream with the stage and an optional error code.
const timeout: DinamikBrandOutcome = { ok: false, reason: "upstream", detail: "getStockList" };
const network: DinamikBrandOutcome = { ok: false, reason: "upstream", detail: "getPriceList ECONNRESET" };

// Runs one tick's brands in order and returns the index of the brand that opened the breaker, or -1.
function openedAt(outcomes: DinamikBrandOutcome[]) {
  let failures = 0;
  for (const [index, outcome] of outcomes.entries()) {
    const next = nextDinamikBreaker(failures, outcome);
    if (next.open) return index;
    failures = next.failures;
  }
  return -1;
}

test("one brand's HTTP 500 does not stop the remaining brands", () => {
  assert.deepEqual(nextDinamikBreaker(0, http500), { failures: 1, open: false });
  assert.equal(openedAt([ok, http500, ok, ok]), -1);
});

test("consecutive upstream failures open the breaker at the limit", () => {
  assert.equal(DINAMIK_UPSTREAM_FAILURE_LIMIT, 3);
  assert.equal(openedAt([ok, http500, http500, http500, ok]), 3);
  assert.equal(openedAt([http500, network, timeout]), 2);
});

test("a successful brand resets the count", () => {
  assert.equal(openedAt([http500, ok, http500]), -1);
  assert.equal(openedAt([http500, http500, ok, http500, http500]), -1);
});

test("401 and 403 open the breaker immediately", () => {
  assert.equal(openedAt([{ ok: false, reason: "upstream", detail: "getStockList HTTP 403" }]), 0);
  assert.equal(openedAt([{ ok: false, reason: "upstream", detail: "getBrandList HTTP 401" }]), 0);
  assert.equal(openedAt([{ ok: false, reason: "upstream", detail: "getStockList HTTP 404" }]), -1);
});

test("config, busy and paused open the breaker immediately", () => {
  for (const reason of ["config", "busy", "paused"]) assert.equal(openedAt([{ ok: false, reason }]), 0, reason);
});

test("a timeout counts like a 5xx", () => {
  assert.equal(openedAt([timeout]), -1);
  assert.equal(openedAt([timeout, timeout, timeout]), 2);
  assert.deepEqual(nextDinamikBreaker(1, timeout), nextDinamikBreaker(1, http500));
});

test("rejected and contract do not open the breaker and reset the count, since Dinamik answered", () => {
  assert.deepEqual(nextDinamikBreaker(2, { ok: false, reason: "rejected", detail: "product-drop-over-20-percent" }), { failures: 0, open: false });
  assert.deepEqual(nextDinamikBreaker(2, { ok: false, reason: "contract", detail: "getStockList JSON" }), { failures: 0, open: false });
  assert.equal(openedAt([http500, http500, { ok: false, reason: "contract" }, http500, http500]), -1);
});
