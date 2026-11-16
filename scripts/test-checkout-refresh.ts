import assert from "node:assert/strict";
import test from "node:test";
import { refreshSuppliersConcurrently, type CheckoutSupplier } from "../src/modules/store/supplier-checkout-refresh";

// Fake refreshers only: no database and no supplier request.
const line = (supplier: CheckoutSupplier) => ({ supplier });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function recorder(delays: { seta: number; basbug: number; dinamik: number }, fail?: CheckoutSupplier) {
  const calls = { seta: 0, basbug: 0, dinamik: 0 };
  const finished = new Set<string>();
  const branch = (supplier: CheckoutSupplier) => async () => {
    calls[supplier]++; await wait(delays[supplier]); finished.add(supplier);
    if (fail === supplier) throw new Error(`${supplier} down`);
  };
  return { run: { seta: branch("seta"), basbug: branch("basbug"), dinamik: branch("dinamik") }, finished, calls };
}

test("suppliers refresh side by side, each supplier's branch called once", async t => {
  const items = [line("basbug"), line("basbug"), line("dinamik"), line("seta"), line("seta")];
  const { run, calls } = recorder({ seta: 300, basbug: 200, dinamik: 100 });
  const started = performance.now();
  assert.deepEqual(await refreshSuppliersConcurrently(items, run), []);
  const elapsed = performance.now() - started;
  t.diagnostic(`concurrent refresh: ${Math.round(elapsed)} ms (serial would be ~${300 + 200 + 100} ms)`);
  assert.ok(elapsed < 550, `expected about 300 ms, took ${Math.round(elapsed)} ms`);
  assert.deepEqual(calls, { seta: 1, basbug: 1, dinamik: 1 });
});

test("a failing branch does not reject: it is returned after the other branches settle", async () => {
  const items = [line("basbug"), line("dinamik"), line("seta")];
  const { run, finished } = recorder({ seta: 250, basbug: 100, dinamik: 10 }, "dinamik");
  const failures = await refreshSuppliersConcurrently(items, run);
  assert.deepEqual(failures.map(failure => failure.supplier), ["dinamik"]);
  assert.match(String(failures[0].reason), /dinamik down/);
  assert.deepEqual([...finished].sort(), ["basbug", "dinamik", "seta"]);
});

test("a failing Başbuğ branch is returned once and the others still finish", async () => {
  const { run, finished, calls } = recorder({ seta: 150, basbug: 20, dinamik: 10 }, "basbug");
  const failures = await refreshSuppliersConcurrently([line("basbug"), line("basbug"), line("seta")], run);
  assert.deepEqual(failures.map(failure => failure.supplier), ["basbug"]);
  assert.equal(calls.basbug, 1);
  assert.ok(finished.has("seta"));
});

test("no supplier lines, no supplier calls", async () => {
  const { run, finished, calls } = recorder({ seta: 0, basbug: 0, dinamik: 0 });
  assert.deepEqual(await refreshSuppliersConcurrently([], run), []);
  assert.equal(finished.size, 0);
  assert.deepEqual(calls, { seta: 0, basbug: 0, dinamik: 0 });
});
