import assert from "node:assert/strict"
import { test } from "node:test"
import { classify } from "./claude-guard.mjs"

const env = (branches = {}, bases = {}) => ({
  cwd: "/repo",
  branchAt: (dir) => branches[dir] ?? "feat/1-x",
  prBase: (_dir, pr) => bases[pr ?? "current"] ?? null,
})
const decide = (command, e = env()) => {
  const { deny, ask } = classify(command, e)
  return deny.length ? "deny" : ask.length ? "ask" : "allow"
}

test("commits: allowed on a worktree branch, denied on dev/main or with --no-verify", () => {
  assert.equal(decide('git commit -m "fix(admin): x"'), "allow")
  assert.equal(decide('git commit -m x', env({ "/repo": "dev" })), "deny")
  assert.equal(decide('git -C /wt commit -m x', env({ "/wt": "main" })), "deny")
  assert.equal(decide('cd /wt && git commit -m x', env({ "/wt": "dev" })), "deny")
  assert.equal(decide("git commit --no-verify -m x"), "deny")
})

test("pushes: own branch passes, main/dev/tags ask, blind force is denied", () => {
  assert.equal(decide("git push -u origin fix/12-thing"), "allow")
  assert.equal(decide("git push --force-with-lease origin fix/12-thing"), "allow")
  assert.equal(decide("git push origin --delete fix/12-thing"), "allow")
  assert.equal(decide("git push origin main"), "ask")
  assert.equal(decide("git push origin HEAD:main"), "ask")
  assert.equal(decide("git push origin origin/main:refs/heads/dev"), "ask")
  assert.equal(decide("git push", env({ "/repo": "main" })), "ask")
  assert.equal(decide("git push origin v0.25.0"), "ask")
  assert.equal(decide("git push --force origin fix/12-thing"), "deny")
  assert.equal(decide("git push origin feat/42-main-menu"), "allow")
})

test("tags: listing is fine, creating a version tag asks", () => {
  assert.equal(decide("git tag --sort=-v:refname"), "allow")
  assert.equal(decide("git tag -l v0.2*"), "allow")
  assert.equal(decide('git tag -a v0.25.0 -m "v0.25.0"'), "ask")
})

test("gh pr merge: base dev passes, base main or unknown asks", () => {
  assert.equal(decide("gh pr merge 490 --squash", env({}, { 490: "dev" })), "allow")
  assert.equal(decide("gh pr merge 491 --merge", env({}, { 491: "main" })), "ask")
  assert.equal(decide("gh pr merge 492"), "ask")
})

test("production release and deploy workflows", () => {
  assert.equal(decide("gh workflow run release-aws.yml --ref main"), "ask")
  assert.equal(decide("gh run rerun 123"), "ask")
  assert.equal(decide("gh workflow enable deploy-production.yml"), "deny")
  assert.equal(decide("gh api repos/o/r/merges -f base=main"), "ask")
  assert.equal(decide("gh run list --branch dev"), "allow")
  assert.equal(decide("gh release view v0.24.0"), "allow")
})

test("local merge into main is denied unless fast-forward", () => {
  assert.equal(decide("git merge dev", env({ "/repo": "main" })), "deny")
  assert.equal(decide("git merge --ff-only origin/dev", env({ "/repo": "dev" })), "allow")
})
