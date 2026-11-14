#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash: keeps git/gh commands inside docs/development-workflow.md.
// The repository has no enforced branch protection, so this guard is the gate.
//   deny → commands that are never part of the flow (commit on dev/main, --no-verify, blind force push)
//   ask  → commands the flow allows only with the user's explicit, per-release approval
//          (anything that changes main, version tags, the AWS production release, a direct push to dev)
// Everything else, including `gh pr merge` of a PR whose base is dev, passes untouched.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

export function branchAt(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function prBase(dir, pr) {
  try {
    const args = ["pr", "view", ...(pr ? [pr] : []), "--json", "baseRefName", "-q", ".baseRefName"]
    return execFileSync("gh", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }).trim()
  } catch {
    return null
  }
}

const MAIN_REF = /(?:^|[\s:/])main(?=\s|$)/
const DEV_REF = /(?:^|[\s:/])dev(?=\s|$)/

/**
 * Classify a shell command. `env` is injectable for tests: { cwd, branchAt(dir), prBase(dir, pr) }.
 * Returns { deny: string[], ask: string[] }.
 */
export function classify(command, env) {
  const deny = []
  const ask = []
  let dir = env.cwd
  const resolveDir = (path) => (isAbsolute(path) ? path : join(dir, path))

  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const segment = raw.trim().replace(/^(?:\w+=\S*\s+)*/, "")
    const cd = segment.match(/^cd\s+(["']?)([^"']+)\1$/)
    if (cd) {
      dir = resolveDir(cd[2].trim())
      continue
    }

    const gitCmd = segment.match(/^git\s+(?:-C\s+(["']?)([^"'\s]+)\1\s+)?(\S+)(.*)$/)
    if (gitCmd) {
      const target = gitCmd[2] ? resolveDir(gitCmd[2]) : dir
      const sub = gitCmd[3]
      const rest = gitCmd[4]
      const branch = env.branchAt(target)

      if (sub === "commit") {
        if (branch === "main" || branch === "dev") {
          deny.push(`committing on ${branch} — open an Issue and commit on a <type>/<N>-<slug> worktree branch`)
        }
        if (/--no-verify|(?:^|\s)-n(?:\s|$)/.test(rest)) deny.push("git commit --no-verify skips the repository's checks")
      }
      if (sub === "push") {
        if (/--force(?!-with-lease)|(?:^|\s)-f(?:\s|$)/.test(rest)) deny.push("force push without lease — use --force-with-lease on your own branch")
        const bare = rest.replace(/\s-{1,2}[\w-]+(?:=\S+)?/g, " ").trim()
        const isDelete = /--delete|(?:^|\s):\S/.test(rest)
        if (!isDelete && (MAIN_REF.test(` ${bare}`) || /--all|--mirror/.test(rest) || (branch === "main" && !/\S+\s+\S+/.test(bare)))) {
          ask.push("push to main — main receives only an approved, versioned release (show version + scope, get explicit approval)")
        } else if (!isDelete && (DEV_REF.test(` ${bare}`) || (branch === "dev" && !/\S+\s+\S+/.test(bare)))) {
          ask.push("direct push to dev — dev changes go through a PR (only the post-release origin/main → dev fast-forward is expected here)")
        }
        if (/--tags|(?:^|\s|\/)v\d+\.\d+\.\d+/.test(rest)) ask.push("pushing a version tag — only for an approved main release")
      }
      if (sub === "tag" && /(?:^|\s)v\d+\.\d+\.\d+/.test(rest) && !/(?:^|\s)(?:-l|--list|-v|--verify|-n\d*)(?:\s|$)/.test(rest)) {
        ask.push("creating a version tag — only on the approved main release commit (annotated vX.Y.Z)")
      }
      if (sub === "merge" && branch === "main" && !/--ff-only|--abort/.test(rest)) {
        deny.push("merging into main locally — main changes only through the approved dev → main release PR")
      }
      continue
    }

    const merge = segment.match(/^gh\s+pr\s+merge\b(.*)$/)
    if (merge) {
      const pr = merge[1].split(/\s+/).find((arg) => arg && !arg.startsWith("-"))
      const base = env.prBase(dir, pr)
      if (base !== "dev") ask.push(`gh pr merge (base: ${base ?? "unknown"}) — only PRs into dev merge without approval`)
      continue
    }
    if (/^gh\s+api\b/.test(segment) && /\/merges\b|git\/refs\/heads\/main|pulls\/\d+\/merge|git\/refs\/tags/.test(segment)) {
      ask.push("gh api merge/ref change — treated like a change to main")
      continue
    }
    if (/^gh\s+(?:workflow\s+run\b.*release-aws|run\s+rerun\b)/.test(segment) || /release-aws.*dispatches/.test(segment)) {
      ask.push("AWS production release (getirbakim.com) — release-aws runs only with the user's separate, explicit release approval")
      continue
    }
    if (/^gh\s+workflow\s+(?:enable|run)\b.*deploy-(?:production|staging)/.test(segment)) {
      deny.push("the Contabo deploy workflows stay disabled unless the user explicitly asks")
      continue
    }
    if (/^gh\s+release\s+create\b/.test(segment)) {
      ask.push("GitHub Release — only for an approved main release")
    }
  }
  return { deny, ask }
}

function main() {
  let input
  try {
    input = JSON.parse(readFileSync(0, "utf8"))
  } catch {
    process.exit(0)
  }
  const command = input.tool_input?.command ?? ""
  if (!/\b(?:git|gh)\b/.test(command)) process.exit(0)
  const { deny, ask } = classify(command, { cwd: input.cwd ?? process.cwd(), branchAt, prBase })
  if (deny.length === 0 && ask.length === 0) process.exit(0)

  const policy = "docs/development-workflow.md"
  const decision = deny.length > 0 ? "deny" : "ask"
  const reasons = deny.length > 0 ? deny : ask
  const reason = `getirbakim flow guard (${policy}):\n- ${[...new Set(reasons)].join("\n- ")}`
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
