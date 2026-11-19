import assert from "node:assert/strict";
import test from "node:test";
import { lazyModule } from "../src/lib/lazy-module";

test("loads the module once and keeps it", async () => {
  let calls = 0;
  const lazy = lazyModule(async () => { calls++; return { value: 1 }; });
  const first = await lazy.preload();
  const second = await lazy.preload();
  assert.equal(calls, 1);
  assert.equal(first, second);
});

test("concurrent preloads share one request", async () => {
  let calls = 0;
  let finish: (module: { value: number }) => void = () => {};
  const lazy = lazyModule(() => { calls++; return new Promise<{ value: number }>(resolve => { finish = resolve; }); });
  const hover = lazy.preload();
  const click = lazy.preload();
  finish({ value: 2 });
  assert.deepEqual(await Promise.all([hover, click]), [{ value: 2 }, { value: 2 }]);
  assert.equal(calls, 1);
});

test("a failed download is forgotten, so the next intent retries", async () => {
  let calls = 0;
  const lazy = lazyModule(async () => {
    calls++;
    if (calls === 1) throw new Error("ChunkLoadError");
    return { value: 3 };
  });
  await assert.rejects(lazy.preload(), /ChunkLoadError/);
  assert.deepEqual(await lazy.preload(), { value: 3 });
  assert.equal(calls, 2);
});

test("a dropped preload that fails does not raise an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const lazy = lazyModule(async () => { throw new Error("offline"); });
    void lazy.preload();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
