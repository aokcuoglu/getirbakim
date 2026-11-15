import assert from "node:assert/strict";
import test from "node:test";
import { refreshSuppliersConcurrently, type CheckoutRefreshScope } from "../src/modules/store/supplier-checkout-refresh";

// Fake refreshers only: no database and no supplier request.
const scope = (supplier: CheckoutRefreshScope["supplier"], list_group = "A"): CheckoutRefreshScope => ({ supplier, company: "TEST", list_group, warehouse: "MRK" });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function recorder(delays: { seta: number; basbug: number; dinamik: number }, fail?: "seta" | "basbug" | "dinamik") {
  const log: string[] = [];
  let basbugInFlight = 0, basbugPeak = 0, seta = 0;
  const finished = new Set<string>();
  const run = {
    async seta() { seta++; await wait(delays.seta); finished.add("seta"); if (fail === "seta") throw new Error("seta down"); },
    async basbug(item: CheckoutRefreshScope) {
      basbugInFlight++; basbugPeak = Math.max(basbugPeak, basbugInFlight); log.push(`basbug:${item.list_group}`);
      await wait(delays.basbug); basbugInFlight--; finished.add(`basbug:${item.list_group}`);
      if (fail === "basbug") throw new Error("basbug busy");
    },
    async dinamik() { await wait(delays.dinamik); finished.add("dinamik"); if (fail === "dinamik") throw new Error("dinamik down"); },
  };
  return { run, log, finished, stats: () => ({ basbugPeak, seta }) };
}

test("suppliers refresh side by side while Başbuğ scopes stay serial and ordered", async t => {
  const scopes = [scope("basbug", "A"), scope("basbug", "B"), scope("dinamik"), scope("seta", "X"), scope("seta", "Y")];
  const { run, log, stats } = recorder({ seta: 300, basbug: 200, dinamik: 100 });
  const started = performance.now();
  await refreshSuppliersConcurrently(scopes, run);
  const elapsed = performance.now() - started;
  t.diagnostic(`concurrent refresh: ${Math.round(elapsed)} ms (serial would be ~${300 + 2 * 200 + 100} ms)`);
  assert.ok(elapsed < 650, `expected about 400 ms, took ${Math.round(elapsed)} ms`);
  assert.ok(elapsed >= 390, `Başbuğ scopes must not overlap, took ${Math.round(elapsed)} ms`);
  assert.deepEqual(log, ["basbug:A", "basbug:B"]);
  assert.deepEqual(stats(), { basbugPeak: 1, seta: 1 });
});

test("a failing branch rejects only after the other branches settle", async () => {
  const scopes = [scope("basbug", "A"), scope("basbug", "B"), scope("dinamik"), scope("seta")];
  const { run, finished } = recorder({ seta: 250, basbug: 100, dinamik: 10 }, "dinamik");
  await assert.rejects(refreshSuppliersConcurrently(scopes, run), /dinamik down/);
  assert.deepEqual([...finished].sort(), ["basbug:A", "basbug:B", "dinamik", "seta"]);
});

test("a failing Başbuğ scope stops its own chain but waits for the others", async () => {
  const { run, finished, log } = recorder({ seta: 150, basbug: 20, dinamik: 10 }, "basbug");
  await assert.rejects(refreshSuppliersConcurrently([scope("basbug", "A"), scope("basbug", "B"), scope("seta")], run), /basbug busy/);
  assert.deepEqual(log, ["basbug:A"]);
  assert.ok(finished.has("seta"));
});

test("no scopes, no supplier calls", async () => {
  const { run, finished, stats } = recorder({ seta: 0, basbug: 0, dinamik: 0 });
  await refreshSuppliersConcurrently([], run);
  assert.equal(finished.size, 0);
  assert.deepEqual(stats(), { basbugPeak: 0, seta: 0 });
});
