#!/usr/bin/env node
// Refuses a local `npm run db:setup` from a branch that does not contain origin/dev: every worktree shares one local
// database, so applying an older db/*.sql set silently rolls back schema changes already merged into dev (#589).
// Only the npm script runs this; scripts/setup.ts (deploy, AWS) is untouched. Bypass: DB_SETUP_ALLOW_STALE=1.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

/**
 * Pure decision. `isRepo`: inside a git work tree. `hasRef`: an origin/dev ref exists. `isAncestor`: origin/dev is an
 * ancestor of HEAD, or null when git answered with something other than yes/no. `behind`: commits HEAD lacks.
 */
export function decide({ allowStale = false, isRepo = true, fetchOk = true, hasRef = true, isAncestor = null, behind = 0, branch = "HEAD" }) {
  if (allowStale) return { ok: true, level: "warn", message: "DB_SETUP_ALLOW_STALE=1: origin/dev kontrolü atlandı." }
  if (!isRepo) return { ok: true, level: "warn", message: "Git deposu bulunamadı, origin/dev kontrolü atlandı." }
  const note = fetchOk ? "" : "origin/dev alınamadı (fetch yapılamadı), yerel ref ile devam ediliyor. "
  if (!hasRef) return { ok: true, level: "warn", message: `${note}origin/dev ref'i yok, kontrol atlandı.`.trim() }
  if (isAncestor === null) return { ok: true, level: "warn", message: `${note}origin/dev karşılaştırılamadı, kontrol atlandı.`.trim() }
  if (isAncestor) return { ok: true, level: fetchOk ? "ok" : "warn", message: fetchOk ? "" : "fetch yapılamadı, kontrol yerel origin/dev ile yapıldı." }
  return {
    ok: false,
    level: "error",
    message: [
      `db:setup durduruldu: "${branch}" dalı origin/dev'in ${behind} commit gerisinde.`,
      "Yerel veritabanı tüm worktree'lerle ortaktır; eski db/*.sql kümesi dev'e girmiş şema değişikliklerini geri sarar.",
      "Önce: git fetch origin && git rebase origin/dev",
      "Bilinçli geçmek için: DB_SETUP_ALLOW_STALE=1 npm run db:setup",
    ].join("\n"),
  }
}

const git = (args, timeout = 15000) => spawnSync("git", args, { encoding: "utf8", timeout })

export function inspect(env = process.env) {
  if (env.DB_SETUP_ALLOW_STALE === "1") return { allowStale: true }
  const inside = git(["rev-parse", "--is-inside-work-tree"])
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== "true") return { isRepo: false }
  const fetchOk = git(["fetch", "origin", "dev", "--quiet"]).status === 0
  const hasRef = git(["rev-parse", "--verify", "--quiet", "origin/dev"]).status === 0
  if (!hasRef) return { fetchOk, hasRef }
  const anc = git(["merge-base", "--is-ancestor", "origin/dev", "HEAD"])
  const isAncestor = anc.status === 0 ? true : anc.status === 1 ? false : null
  const behind = Number(git(["rev-list", "--count", "HEAD..origin/dev"]).stdout.trim()) || 0
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() || "HEAD"
  return { fetchOk, hasRef, isAncestor, behind, branch }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = decide(inspect())
  if (result.message) (result.ok ? console.warn : console.error)(result.level === "warn" ? `Uyarı: ${result.message}` : result.message)
  process.exit(result.ok ? 0 : 1)
}
