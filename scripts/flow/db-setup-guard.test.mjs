import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { decide } from "./db-setup-guard.mjs"

const guard = fileURLToPath(new URL("./db-setup-guard.mjs", import.meta.url))

test("behind origin/dev: refuse with branch, count and the fix", () => {
  const r = decide({ isAncestor: false, behind: 3, branch: "feat/1-x" })
  assert.equal(r.ok, false)
  assert.match(r.message, /feat\/1-x/)
  assert.match(r.message, /3 commit/)
  assert.match(r.message, /git rebase origin\/dev/)
  assert.match(r.message, /DB_SETUP_ALLOW_STALE=1/)
})

test("up to date passes; escape hatch passes", () => {
  assert.equal(decide({ isAncestor: true }).ok, true)
  assert.equal(decide({ allowStale: true, isAncestor: false, behind: 9 }).ok, true)
})

test("not a repo, missing ref, fetch failure, unknown git error: warn and pass", () => {
  assert.deepEqual(decide({ isRepo: false }).level, "warn")
  assert.equal(decide({ hasRef: false }).ok, true)
  assert.equal(decide({ isAncestor: null }).ok, true)
  const r = decide({ fetchOk: false, isAncestor: true })
  assert.equal(r.ok, true)
  assert.equal(r.level, "warn")
  assert.equal(decide({ fetchOk: false, isAncestor: false, behind: 1 }).ok, false)
})

test("integration: temp repo behind and up to date with its origin/dev", () => {
  const root = mkdtempSync(join(tmpdir(), "dbguard-"))
  const run = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
  }
  const cfg = ["-c", "user.name=t", "-c", "user.email=t@t"]
  const origin = join(root, "origin.git")
  const a = join(root, "a")
  const b = join(root, "b")
  run(root, "init", "--bare", "-b", "dev", origin)
  run(root, "clone", origin, a)
  writeFileSync(join(a, "f"), "1")
  run(a, "add", "f")
  run(a, ...cfg, "commit", "-m", "one")
  run(a, "push", "origin", "HEAD:dev")
  run(root, "clone", "-b", "dev", origin, b)
  const exec = (cwd) => spawnSync("node", [guard], { cwd, encoding: "utf8", env: { ...process.env, DB_SETUP_ALLOW_STALE: "" } })
  assert.equal(exec(b).status, 0)
  writeFileSync(join(a, "f"), "2")
  run(a, ...cfg, "commit", "-am", "two")
  run(a, "push", "origin", "HEAD:dev")
  const behind = exec(b)
  assert.equal(behind.status, 1)
  assert.match(behind.stderr, /1 commit gerisinde/)
  assert.equal(spawnSync("node", [guard], { cwd: b, encoding: "utf8", env: { ...process.env, DB_SETUP_ALLOW_STALE: "1" } }).status, 0)
})
