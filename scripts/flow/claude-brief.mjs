#!/usr/bin/env node
// Claude Code SessionStart hook: puts the flow rules and the repository's current state into the
// session context (docs/development-workflow.md, docs/harness/README.md). Never fails the session:
// any error only shortens the brief.
import { execFileSync } from "node:child_process"

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const run = (cmd, args, timeout = 8000) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout }).trim()

const lines = [
  "getirbakim flow (docs/development-workflow.md; harness: docs/harness/README.md) — every development:",
  "1. Issue first (/issue), then a worktree from origin/dev: ../getirbakim-<N>, branch <type>/<N>-<slug>. Never commit on dev or main.",
  "2. Conventional commits/PR titles: <type>(<area>): <summary>; labels = type + area:* (+ release:minor|patch for behaviour changes).",
  "3. PR --base dev with Closes #N → CI green → merge into dev without asking → fast-forward the main checkout (dev) → remove own worktree/branch.",
  "4. main = releasable version: dev → main only as a versioned release with the user's explicit approval (/release-check). AWS production (release-aws.yml) is a separate, explicitly approved step.",
  "5. /ship <N|description> runs the whole pipeline with the getirbakim-* agents (planner → developer → reviewer + ui-ux → qa).",
]

try {
  run("git", ["fetch", "--quiet", "origin", "dev", "main", "--tags"], 15000)
} catch {
  lines.push("(offline: state below may be stale)")
}

try {
  const tag = run("git", ["describe", "--tags", "--abbrev=0", "origin/main"])
  const pending = run("git", ["log", "--first-parent", "--format=%s", "origin/main..origin/dev"]).split("\n").filter(Boolean)
  const prs = pending.filter((s) => /^Merge pull request/.test(s)).length
  lines.push("", `Latest release: ${tag}. dev is ${pending.length} commit(s) (${prs} merged PR(s)) ahead of main.`)
  if (prs >= 10) lines.push("Suggest a versioned release to the user when a natural batch is complete (/release-check) — never release without approval.")
} catch {
  // No tags or remotes yet.
}

try {
  const prs = JSON.parse(run("gh", ["pr", "list", "--json", "number,title,headRefName,baseRefName,isDraft"]))
  if (prs.length > 0) {
    lines.push("", "Open PRs:")
    for (const pr of prs) lines.push(`  #${pr.number} ${pr.title} [${pr.headRefName} → ${pr.baseRefName}]${pr.isDraft ? " (draft)" : ""}`)
  }
} catch {
  // gh unavailable or not authenticated.
}

try {
  const worktrees = run("git", ["worktree", "list"]).split("\n").slice(1).filter(Boolean)
  if (worktrees.length > 0) {
    lines.push("", "Other worktrees (belong to other work — never clean them up):", ...worktrees.map((line) => `  ${line}`))
  }
} catch {
  // Not a git checkout.
}

console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } }))
