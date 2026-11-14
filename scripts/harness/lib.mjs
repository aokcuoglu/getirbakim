// Shared helpers for the getirbakim agent harness (docs/harness/README.md).
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** The checkout these scripts live in (main checkout or a worktree). */
export const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

/** Folders that make up the /yonetim admin UI (AGENTS.md → "Yönetim paneli UI kuralı"). */
export const ADMIN_ROOTS = ["src/app/yonetim", "src/components/admin"]

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

/** Top level of the git checkout containing `dir`, or null outside git. */
export function repoRoot(dir) {
  try {
    return git(dir, "rev-parse", "--show-toplevel")
  } catch {
    return null
  }
}

/** A getirbakim checkout has the admin rule in AGENTS.md and the /yonetim route. */
export function isGetirbakimCheckout(root) {
  return Boolean(root) && existsSync(join(root, "AGENTS.md")) && existsSync(join(root, "src/app/yonetim"))
}

export function isAdminPath(rel) {
  return ADMIN_ROOTS.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))
}

/** Files under `dir` (or `dir` itself when it is a file). */
export function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  if (!statSync(dir).isDirectory()) {
    out.push(dir)
    return out
  }
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

/**
 * Files changed on this branch: committed diff against the merge base with origin/dev, plus staged,
 * unstaged and untracked files. Paths are relative to `root`. NUL-separated so Turkish/bracketed
 * paths (`[id]`) survive.
 */
export function changedFiles(root, base = "origin/dev") {
  const files = new Set()
  const add = (out) => out.split("\0").filter(Boolean).forEach((path) => files.add(path))
  try {
    add(git(root, "diff", "-z", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`))
  } catch {
    // No origin/dev (fresh clone without fetch): fall back to the working tree only.
  }
  add(git(root, "diff", "-z", "--name-only", "--diff-filter=ACMR", "HEAD"))
  add(git(root, "ls-files", "-z", "--others", "--exclude-standard"))
  return [...files].filter((path) => existsSync(join(root, path)))
}
