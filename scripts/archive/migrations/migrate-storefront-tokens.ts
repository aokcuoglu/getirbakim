/**
 * Scoped codemod: migrate storefront/customer-facing files to shadcn semantic tokens.
 * Run: bun scripts/migrate-storefront-tokens.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'admin', 'ui'])

const REPLACEMENTS: Array<[RegExp, string]> = [
  // Hex text colors
  [/text-\[#101828\]/g, 'text-foreground'],
  [/text-\[#667085\]/g, 'text-muted-foreground'],
  [/text-\[#212b36\]/g, 'text-foreground'],
  [/text-\[#637381\]/g, 'text-muted-foreground'],
  [/text-\[#919eab\]/g, 'text-muted-foreground'],
  [/text-\[#52606d\]/g, 'text-muted-foreground'],
  [/text-\[#7b8794\]/g, 'text-muted-foreground'],
  [/text-\[#9aa5b1\]/g, 'text-muted-foreground'],
  [/text-\[#1f2937\]/g, 'text-foreground'],
  [/text-\[#0f6cbd\]/g, 'text-primary'],
  [/text-\[#0088CC\]/g, 'text-primary'],

  // Slate text
  [/text-slate-950/g, 'text-foreground'],
  [/text-slate-900/g, 'text-foreground'],
  [/text-slate-800/g, 'text-foreground'],
  [/text-slate-700/g, 'text-foreground'],
  [/text-slate-600/g, 'text-muted-foreground'],
  [/text-slate-500/g, 'text-muted-foreground'],
  [/text-slate-400/g, 'text-muted-foreground'],
  [/text-slate-300/g, 'text-muted-foreground/70'],
  [/text-slate-200/g, 'text-primary-foreground/80'],

  // Gray text
  [/text-gray-950/g, 'text-foreground'],
  [/text-gray-900/g, 'text-foreground'],
  [/text-gray-800/g, 'text-foreground'],
  [/text-gray-700/g, 'text-foreground'],
  [/text-gray-600/g, 'text-muted-foreground'],
  [/text-gray-500/g, 'text-muted-foreground'],
  [/text-gray-400/g, 'text-muted-foreground'],
  [/text-gray-300/g, 'text-muted-foreground/50'],

  // Sky text
  [/text-sky-900/g, 'text-primary'],
  [/text-sky-800/g, 'text-primary'],
  [/text-sky-700/g, 'text-primary'],
  [/text-sky-600/g, 'text-primary'],

  // Blue text
  [/text-blue-900/g, 'text-primary'],
  [/text-blue-800/g, 'text-primary'],
  [/text-blue-700/g, 'text-primary'],
  [/text-blue-600/g, 'text-primary'],
  [/text-blue-500/g, 'text-primary'],
  [/text-blue-100/g, 'text-primary-foreground/80'],
  [/hover:text-blue-800/g, 'hover:text-primary'],
  [/hover:text-blue-700/g, 'hover:text-primary'],
  [/hover:text-blue-600/g, 'hover:text-primary'],

  // Emerald text
  [/text-emerald-900/g, 'text-success'],
  [/text-emerald-800/g, 'text-success'],
  [/text-emerald-700/g, 'text-success'],
  [/text-emerald-600/g, 'text-success'],
  [/text-emerald-500/g, 'text-success'],

  // Backgrounds
  [/bg-slate-950/g, 'bg-foreground'],
  [/bg-slate-900/g, 'bg-primary'],
  [/bg-slate-800/g, 'bg-primary'],
  [/bg-slate-700/g, 'bg-primary'],
  [/bg-slate-400/g, 'bg-muted-foreground/40'],
  [/bg-slate-300/g, 'bg-muted-foreground/30'],
  [/bg-slate-200/g, 'bg-muted'],
  [/bg-slate-100/g, 'bg-muted'],
  [/bg-slate-50/g, 'bg-muted'],
  [/bg-gray-200/g, 'bg-muted'],
  [/bg-gray-100/g, 'bg-muted'],
  [/bg-gray-50/g, 'bg-muted'],
  [/from-slate-50/g, 'from-muted'],
  [/to-slate-100/g, 'to-muted'],
  [/from-slate-100/g, 'from-muted'],
  [/to-slate-50/g, 'to-muted'],
  [/from-slate-900/g, 'from-foreground'],
  [/via-slate-900/g, 'via-foreground'],
  [/to-white/g, 'to-background'],
  [/bg-blue-600/g, 'bg-primary'],
  [/bg-blue-500/g, 'bg-primary'],
  [/bg-blue-50/g, 'bg-accent'],
  [/bg-blue-100/g, 'bg-accent'],
  [/bg-sky-100/g, 'bg-accent'],
  [/bg-sky-50/g, 'bg-accent'],
  [/bg-emerald-50/g, 'bg-success/10'],
  [/bg-emerald-100/g, 'bg-success/15'],
  [/bg-\[#00b67a\]/g, 'bg-success'],
  [/bg-\[#f8f9f9\]/g, 'bg-muted'],
  [/hover:bg-\[#f8f9f9\]/g, 'hover:bg-accent'],

  // Borders
  [/border-slate-900/g, 'border-primary'],
  [/border-slate-400/g, 'border-input'],
  [/border-slate-300/g, 'border-input'],
  [/border-slate-200/g, 'border-border'],
  [/border-slate-100/g, 'border-border'],
  [/border-gray-300/g, 'border-input'],
  [/border-gray-200/g, 'border-border'],
  [/border-gray-100/g, 'border-border'],
  [/border-blue-600/g, 'border-primary'],
  [/border-blue-200/g, 'border-border'],
  [/border-blue-100/g, 'border-border'],
  [/border-sky-600/g, 'border-primary'],
  [/border-sky-500/g, 'border-primary'],
  [/border-sky-100/g, 'border-border'],
  [/border-sky-200/g, 'border-border'],
  [/border-emerald-100/g, 'border-success/20'],
  [/border-emerald-200/g, 'border-success/20'],
  [/border-\[#dfe5eb\]/g, 'border-border'],
  [/border-\[#c4cdd5\]/g, 'border-input'],
  [/border-\[#e7edf2\]/g, 'border-border'],
  [/divide-slate-200/g, 'divide-border'],
  [/divide-slate-100/g, 'divide-border'],
  [/divide-gray-200/g, 'divide-border'],

  // Hover backgrounds
  [/hover:bg-slate-400/g, 'hover:bg-muted-foreground/40'],
  [/hover:bg-slate-300/g, 'hover:bg-muted-foreground/30'],
  [/hover:bg-slate-200/g, 'hover:bg-accent'],
  [/hover:bg-slate-100/g, 'hover:bg-accent'],
  [/hover:bg-slate-50/g, 'hover:bg-accent'],
  [/hover:bg-gray-200/g, 'hover:bg-accent'],
  [/hover:bg-gray-100/g, 'hover:bg-accent'],
  [/hover:bg-gray-50/g, 'hover:bg-accent'],
  [/hover:bg-slate-800/g, 'hover:bg-primary/90'],
  [/hover:bg-slate-900/g, 'hover:bg-primary/90'],
  [/hover:bg-blue-700/g, 'hover:bg-primary/90'],
  [/hover:bg-blue-800/g, 'hover:bg-primary/90'],
  [/hover:bg-sky-100/g, 'hover:bg-accent'],
  [/hover:bg-sky-50/g, 'hover:bg-accent'],
  [/hover:bg-\[#0077b3\]/g, 'hover:bg-primary/90'],
  [/hover:bg-\[#0b68c4\]/g, 'hover:bg-primary/90'],
  [/hover:text-slate-200/g, 'hover:text-primary-foreground/80'],
  [/hover:text-slate-900/g, 'hover:text-foreground'],
  [/hover:text-slate-700/g, 'hover:text-foreground'],
  [/hover:text-gray-900/g, 'hover:text-foreground'],
  [/hover:border-slate-400/g, 'hover:border-input'],

  // Active
  [/active:bg-blue-800/g, 'active:bg-primary/90'],
  [/active:bg-sky-700/g, 'active:bg-primary/90'],

  // Focus rings
  [/focus:ring-sky-500/g, 'focus-visible:ring-ring/50'],
  [/focus:ring-slate-200/g, 'focus-visible:ring-ring/50'],
  [/focus:ring-slate-900/g, 'focus-visible:ring-ring/50'],
  [/focus:border-slate-400/g, 'focus-visible:border-ring'],
  [/focus:border-\[#98a6b3\]/g, 'focus-visible:border-ring'],
  [/focus:ring-\[#98a6b3\]/g, 'focus-visible:ring-ring/50'],
  [/focus:ring-\[#eef2f5\]/g, 'focus-visible:ring-ring/50'],
  [/focus:ring-emerald-500/g, 'focus-visible:ring-ring/50'],
  [/focus:border-emerald-500/g, 'focus-visible:border-ring'],
  [/focus:ring-blue-500/g, 'focus-visible:ring-ring/50'],
  [/focus:border-blue-500/g, 'focus-visible:border-ring'],
  [/focus-visible:ring-blue-500/g, 'focus-visible:ring-ring/50'],
  [/focus-visible:ring-emerald-500/g, 'focus-visible:ring-ring/50'],
  [/border-t-slate-600/g, 'border-t-primary'],
  [/border-t-blue-600/g, 'border-t-primary'],
  [/ring-sky-500/g, 'ring-primary'],
  [/ring-blue-500/g, 'ring-primary'],
  [/ring-blue-600/g, 'ring-primary'],
  [/ring-slate-500/g, 'ring-muted-foreground'],
  [/ring-slate-300/g, 'ring-border'],
  [/ring-slate-200/g, 'ring-border'],
  [/ring-emerald-600/g, 'ring-success'],
  [/accent-slate-900/g, 'accent-primary'],
  [/placeholder-slate-400/g, 'placeholder:text-muted-foreground'],
  [/placeholder:text-\[#7b8794\]/g, 'placeholder:text-muted-foreground'],
  [/fill-emerald-500/g, 'fill-success'],
  [/fill-\[#00b67a\]/g, 'fill-success'],
  [/text-\[#00b67a\]/g, 'text-success'],

  // Gradients
  [/from-blue-600/g, 'from-primary'],
  [/via-blue-500/g, 'via-primary'],
  [/to-blue-400/g, 'to-primary'],

  // Brand hex backgrounds -> primary (keep TR plate red as destructive)
  [/hover:bg-\[#0f75d8\]/g, 'hover:bg-primary/90'],
]

function shouldSkipDir(name: string, parentPath: string): boolean {
  if (SKIP_DIRS.has(name)) return true
  return false
}

function walk(dir: string, files: string[] = [], inAppLocale = false): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (SKIP_DIRS.has(entry)) continue
    const stat = statSync(full)
    if (stat.isDirectory()) {
      const nextInAppLocale = inAppLocale || entry === '[locale]'
      if (entry === 'admin' && nextInAppLocale) continue
      walk(full, files, nextInAppLocale)
    } else if (
      (entry.endsWith('.tsx') || entry.endsWith('.ts')) &&
      !full.includes('/components/ui/') &&
      !full.includes('/components/admin/') &&
      !full.includes('/app/[locale]/admin/')
    ) {
      const rel = relative(ROOT, full)
      if (rel.startsWith('components/') || rel.startsWith('app/[locale]/')) {
        files.push(full)
      }
    }
  }
  return files
}

let changedFiles = 0
let totalReplacements = 0

for (const file of walk(ROOT)) {
  const original = readFileSync(file, 'utf8')
  let content = original
  let fileChanges = 0

  for (const [pattern, replacement] of REPLACEMENTS) {
    const matches = content.match(pattern)
    if (matches) {
      fileChanges += matches.length
      content = content.replace(pattern, replacement)
    }
  }

  if (content !== original) {
    writeFileSync(file, content)
    changedFiles++
    totalReplacements += fileChanges
    console.log(`${relative(ROOT, file)} (${fileChanges} replacements)`)
  }
}

console.log(`\nDone: ${changedFiles} files, ~${totalReplacements} replacements`)
