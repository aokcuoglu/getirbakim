#!/usr/bin/env node
// Deterministic check of the /yonetim UI rule in AGENTS.md ("Admin panel (/yonetim) UI rule"):
// admin screens are built from stock shadcn/ui components only. What a regex can see is checked here;
// the rest (re-coloring a Badge through className, wrong variant for a status) is for the
// getirbakim-ui-ux agent.
//
// Usage: node scripts/harness/admin-ui-lint.mjs [--changed | path…] [--warn]
//   --changed  files changed on this branch vs origin/dev + working tree (default: all admin files)
//   --warn     report only, always exit 0 (used by the post-edit hook)
// Escape hatch: put `admin-ui-lint-ignore` on the line (and say why in a comment).
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { ADMIN_ROOTS, changedFiles, isAdminPath, repoRoot, SCRIPT_ROOT, walk } from "./lib.mjs"

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
const COLOR_UTILS = "bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|accent|caret|shadow|placeholder"

export const RULES = [
  {
    id: "inline-style",
    pattern: /\bstyle=\{/,
    message: "inline style={} — use stock component props/variants and layout classes",
  },
  {
    id: "arbitrary-value",
    // w-[45%], rounded-[4px], min-w-[28rem], grid-cols-[2fr_1fr], bg-[var(--x)]
    pattern: /(?<![\w-])[a-z][\w-]*-\[[^\]\s"'`]+\]/,
    message: "arbitrary Tailwind value — use the standard scale (w-1/2, max-w-7xl, rounded-md …)",
  },
  {
    id: "arbitrary-variant",
    // [&>svg]:size-4, data-[state=open]:…, has-[…]: — restyles stock component internals
    pattern: /(?<![\w-])(?:\[&[^\]]*\]|[a-z-]+-\[[^\]]+\]):/,
    message: "arbitrary variant selector — stock components already style their parts",
  },
  {
    id: "hex-color",
    pattern: /(?<![\w&])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/,
    message: "hex color — use theme tokens (.admin-app in src/app/admin.css)",
  },
  {
    id: "palette-color",
    pattern: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${COLOR_UTILS})-(?:${PALETTE})-\\d{2,3}\\b`),
    message: "raw palette color — use tokens: text-muted-foreground, text-success/warning/destructive/info, Badge/Alert variants",
  },
  {
    id: "black-white",
    pattern: /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border|fill|stroke)-(?:white|black)\b/,
    message: "bg/text-white|black — use background/foreground tokens",
  },
  {
    id: "dark-variant",
    // dark:hidden / dark:block (theme-dependent icons) are fine; colour overrides are not.
    pattern: /(?<![\w-])dark:(?:[\w-]+:)*(?:bg|text|border|ring|fill|stroke|shadow|outline|divide|from|via|to)-/,
    message: "dark: colour override — the .admin-app tokens already switch between g10 and g100",
  },
  {
    id: "restyle",
    // Corner and elevation changes on components (AGENTS.md: no corner/shadow changes).
    pattern: /(?<![\w-])(?:[\w-]+:)*(?:rounded(?:-[trblse]{1,2})?(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl))?|shadow(?:-(?:none|2xs|xs|sm|md|lg|xl|2xl|inner))?)(?![\w-])/,
    classOnly: true,
    // Warning only: the ui-ux agent judges whether it re-skins a component. A framed part goes in a
    // Card (`<Card size="sm" className="py-0"><CardContent><Accordion…>`), not `rounded-lg border`.
    // Stock shadcn blocks that ship a radius class (sidebar-07 logo tile, NavUser avatar in
    // admin-nav.tsx) carry a per-line `admin-ui-lint-ignore` naming the block.
    severity: "warning",
    message: "corner/shadow change through className — keep the component's own radius and elevation",
  },
  {
    id: "legacy-admin-ui",
    pattern: /from\s+["']@\/components\/admin\/ui(?:\/|["'])/,
    message: "the old components/admin/ui wrapper is gone — import from @/components/ui",
  },
  {
    id: "shadcn-cn-import",
    pattern: /from\s+["']cn["']/,
    message: 'shadcn CLI wrote `import { cn } from "cn"` — change it to "@/lib/utils"',
  },
  {
    id: "css-import",
    pattern: /^\s*import\s+(?:[\w{}\s,*]+from\s+)?["'][^"']+\.(?:css|scss)["']/,
    message: "custom stylesheet in the admin UI — use stock components and tokens",
  },
]

// className-ish contexts: className="…", className={cn("…")}, cva("…"), variants objects, clsx().
const CLASS_CONTEXT = /\b(?:className|class)\s*=|\bcn\(|\bclsx\(|\bcva\(|\btw`/

export function lintSource(source, file = "<input>") {
  const findings = []
  const lines = source.split("\n")
  // Track multi-line className={cn(…)} blocks for class-only rules.
  let classDepth = 0
  lines.forEach((line, index) => {
    if (line.includes("admin-ui-lint-ignore")) return
    const startsClass = CLASS_CONTEXT.test(line)
    const inClass = startsClass || classDepth > 0
    if (startsClass || classDepth > 0) {
      classDepth = Math.max(0, classDepth + (line.split("(").length - 1) - (line.split(")").length - 1))
    }
    // Comments (JSDoc lines, // tails, {/* */}) often carry issue refs like (#475): skip them.
    if (/^\s*(?:\*|\/\*|\/\/)/.test(line)) return
    const code = line.replace(/\{?\/\*.*?\*\/\}?/g, "").replace(/(^|[^:"'`])\/\/.*$/, "$1")
    for (const rule of RULES) {
      if (rule.classOnly && !inClass) continue
      const match = code.match(rule.pattern)
      if (match) {
        findings.push({ file, line: index + 1, rule: rule.id, severity: rule.severity ?? "error", text: match[0], message: rule.message })
      }
    }
  })
  return findings
}

function targets(root, args) {
  const paths = args.filter((arg) => !arg.startsWith("--"))
  let files
  if (args.includes("--changed")) files = changedFiles(root)
  else if (paths.length > 0) files = paths.flatMap((path) => walk(resolve(root, path)).map((abs) => abs.slice(root.length + 1)))
  else files = ADMIN_ROOTS.flatMap((dir) => walk(join(root, dir))).map((abs) => abs.slice(root.length + 1))
  return [...new Set(files)].filter((path) => isAdminPath(path) && /\.(tsx|ts|jsx|css)$/.test(path))
}

function main() {
  const args = process.argv.slice(2)
  const root = repoRoot(process.cwd()) ?? SCRIPT_ROOT
  const files = targets(root, args)
  const findings = files.flatMap((file) => lintSource(readFileSync(join(root, file), "utf8"), file))
  const errors = findings.filter((f) => f.severity === "error")
  const warnings = findings.length - errors.length
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.severity}  ${f.rule}  ${f.text}  — ${f.message}`)
  const scope = args.includes("--changed") ? "changed admin files (vs origin/dev + working tree)" : "admin files"
  if (findings.length === 0) {
    console.log(`admin-ui-lint: no violations — scanned ${files.length} ${scope} in ${root}`)
    return
  }
  console.log(`admin-ui-lint: ${errors.length} error(s), ${warnings} warning(s) — scanned ${files.length} ${scope}`)
  if (errors.length > 0 && !args.includes("--warn")) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main()
