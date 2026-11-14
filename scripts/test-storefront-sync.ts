import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { acquireLock, parseBaseline, releaseLock, sinceFrom, statePath, summarizeParts } from "./storefront-sync-state";

test("each target keeps its own watermark; the VPS keeps state.json", () => {
  assert.equal(statePath("vps"), ".local/storefront-sync/state.json");
  assert.equal(statePath("aws"), ".local/storefront-sync/state.aws.json");
});

test("the next --since is the last snapshot minus the overlap; no state sends everything", () => {
  assert.equal(sinceFrom({ snapshotAt: "2026-11-13T05:47:24.000Z" }, 60 * 60 * 1000), "2026-11-13T04:47:24.000Z");
  assert.equal(sinceFrom(null, 60 * 60 * 1000), null);
  assert.throws(() => sinceFrom({ snapshotAt: "nonsense" }, 0), /Invalid snapshotAt/);
});

test("a baseline must be an ISO timestamp that is not in the future", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(parseBaseline("2026-11-13T05:47:24Z", now), "2026-11-13T05:47:24.000Z");
  assert.throws(() => parseBaseline("yesterday", now), /ISO timestamp/);
  assert.throws(() => parseBaseline("2026-13-40T00:00:00Z", now), /ISO timestamp/);
  assert.throws(() => parseBaseline("2026", now), /ISO timestamp/);
  assert.throws(() => parseBaseline("2026-11-15T00:00:00Z", now), /future/);
});

test("the lock admits one live sync, takes over a dead holder's lock and is free again after release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storefront-lock-"));
  const path = join(dir, "sync.lock");
  try {
    acquireLock(path, { pid: process.pid, target: "aws" });
    const held = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(held.pid, process.pid);
    assert.equal(held.target, "aws");
    assert.ok(!Number.isNaN(new Date(held.startedAt).getTime()));
    assert.throws(() => acquireLock(path, { pid: process.pid, target: "vps" }), /Another storefront sync is running/);

    // Another process's release leaves the lock alone.
    releaseLock(path, process.pid + 1);
    assert.ok(existsSync(path));
    releaseLock(path);
    assert.ok(!existsSync(path));
    acquireLock(path, { pid: process.pid, target: "vps" });
    releaseLock(path);

    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    writeFileSync(path, JSON.stringify({ pid: dead, startedAt: "2026-11-13T00:00:00Z", target: "aws" }));
    acquireLock(path, { pid: process.pid, target: "aws" });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, process.pid);
    releaseLock(path);
    releaseLock(path); // Releasing a missing lock is harmless.
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the dry-run summary counts every part, part-00 apart", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-summary-"));
  const source = join(root, "full");
  const media = [{ id: "c", key: "cat/c.jpg", size: 10 }, { id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 70 }];
  try {
    for (const object of media) {
      await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
      await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
    }
    await writeFile(join(source, "manifest.json"), JSON.stringify({
      snapshotAt: "2026-11-14T00:00:00Z", categories: [], labels: [], logos: [],
      images: [{ source: "trodo", category_id: 1, media_id: "c" }],
      jobs: [{ supplier_item_id: "i1", status: "complete" }, { supplier_item_id: "i9", status: "partial" }],
      enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }, { supplier_item_id: "i3", image_id: null }],
      products: [{ supplier_item_id: "i1", category_id: 1 }, { supplier_item_id: "i3", category_id: 1 }],
      media: media.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size })),
    }));
    const partsDir = join(root, "parts");
    await splitStorefrontBundle(source, partsDir, 100);
    const summary = await summarizeParts(partsDir);
    assert.deepEqual(summary.base, { part: "part-00", enrichments: 0, mappings: 0, jobs: 2, media: 1, mediaBytes: 10 });
    assert.deepEqual(summary.parts, [
      { part: "part-01", enrichments: 1, mappings: 1, jobs: 0, media: 1, mediaBytes: 60 },
      { part: "part-02", enrichments: 2, mappings: 1, jobs: 0, media: 1, mediaBytes: 70 },
    ]);
    assert.deepEqual(summary.totals, { parts: 3, enrichments: 3, mappings: 2, jobs: 2, media: 3, mediaBytes: 140 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
