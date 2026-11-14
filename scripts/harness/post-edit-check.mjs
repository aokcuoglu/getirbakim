#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write|MultiEdit): runs admin-ui-lint on the file that was just
// written when it belongs to the /yonetim UI, and hands findings back to the agent as context.
// Never blocks. The hook command points at $CLAUDE_PROJECT_DIR (the main checkout), but agents edit
// files in issue worktrees, so the checkout is taken from the edited file and its own lint copy runs.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { isAdminPath, isGetirbakimCheckout, repoRoot, SCRIPT_ROOT } from "./lib.mjs"

let input
try {
  input = JSON.parse(readFileSync(0, "utf8"))
} catch {
  process.exit(0)
}
const filePath = input.tool_input?.file_path ?? input.tool_input?.path
if (!filePath) process.exit(0)
let absPath
try {
  absPath = realpathSync(filePath)
} catch {
  process.exit(0)
}
const root = repoRoot(dirname(absPath))
if (!isGetirbakimCheckout(root)) process.exit(0)
const rel = relative(root, absPath)
if (!isAdminPath(rel) || !/\.(tsx|ts|jsx|css)$/.test(rel)) process.exit(0)

const own = join(root, "scripts/harness/admin-ui-lint.mjs")
const script = existsSync(own) ? own : join(SCRIPT_ROOT, "scripts/harness/admin-ui-lint.mjs")
let out
try {
  out = execFileSync("node", [script, rel, "--warn"], { cwd: root, encoding: "utf8" })
} catch (error) {
  out = `${error.stdout ?? ""}${error.stderr ?? ""}`
}
if (/no violations/.test(out)) process.exit(0)

const context = `getirbakim admin-ui-lint for ${rel} (AGENTS.md → Yönetim paneli UI kuralı; fix errors before moving on, judge warnings):\n\n${out.trim()}`
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }))
