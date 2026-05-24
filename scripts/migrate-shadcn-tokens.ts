/**
 * One-time codemod: replace hardcoded Tailwind palette classes with shadcn semantic tokens.
 * Run: bun scripts/migrate-shadcn-tokens.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist'])
const SKIP_FILES = new Set(['migrate-shadcn-tokens.ts'])

const REPLACEMENTS: Array<[RegExp, string]> = [
  // Hex text colors
  [/text-\[#101828\]/g, 'text-foreground'],
  [/text-\[#667085\]/g, 'text-muted-foreground'],
  [/text-\[#212b36\]/g, 'text-foreground'],
  [/text-\[#637381\]/g, 'text-muted-foreground'],
  [/text-\[#919eab\]/g, 'text-muted-foreground'],

  // Slate text
  [/text-slate-950/g, 'text-foreground'],
  [/text-slate-900/g, 'text-foreground'],
  [/text-slate-800/g, 'text-foreground'],
  [/text-slate-700/g, 'text-foreground'],
  [/text-slate-600/g, 'text-muted-foreground'],
  [/text-slate-500/g, 'text-muted-foreground'],
  [/text-slate-400/g, 'text-muted-foreground'],
  [/text-slate-300/g, 'text-muted-foreground/70'],

  // Gray text
  [/text-gray-950/g, 'text-foreground'],
  [/text-gray-900/g, 'text-foreground'],
  [/text-gray-800/g, 'text-foreground'],
  [/text-gray-700/g, 'text-foreground'],
  [/text-gray-600/g, 'text-muted-foreground'],
  [/text-gray-500/g, 'text-muted-foreground'],
  [/text-gray-400/g, 'text-muted-foreground'],

  // Backgrounds
  [/bg-slate-950/g, 'bg-foreground'],
  [/bg-slate-900/g, 'bg-primary'],
  [/bg-slate-100/g, 'bg-muted'],
  [/bg-slate-50/g, 'bg-muted'],
  [/bg-gray-100/g, 'bg-muted'],
  [/bg-gray-50/g, 'bg-muted'],
  [/bg-white(?![/])/g, 'bg-background'],

  // Borders
  [/border-slate-300/g, 'border-input'],
  [/border-slate-200/g, 'border-border'],
  [/border-slate-100/g, 'border-border'],
  [/border-gray-300/g, 'border-input'],
  [/border-gray-200/g, 'border-border'],
  [/border-gray-100/g, 'border-border'],
  [/divide-slate-200/g, 'divide-border'],
  [/divide-gray-200/g, 'divide-border'],

  // Hover backgrounds
  [/hover:bg-slate-100/g, 'hover:bg-accent'],
  [/hover:bg-slate-50/g, 'hover:bg-accent'],
  [/hover:bg-gray-100/g, 'hover:bg-accent'],
  [/hover:bg-gray-50/g, 'hover:bg-accent'],
  [/hover:bg-slate-800/g, 'hover:bg-primary/90'],
  [/hover:bg-slate-900/g, 'hover:bg-primary/90'],

  // Hover text
  [/hover:text-slate-900/g, 'hover:text-foreground'],
  [/hover:text-slate-700/g, 'hover:text-foreground'],
  [/hover:text-gray-900/g, 'hover:text-foreground'],

  // Focus rings
  [/focus:ring-emerald-500/g, 'focus-visible:ring-ring/50'],
  [/focus:border-emerald-500/g, 'focus-visible:border-ring'],
  [/focus:ring-blue-500/g, 'focus-visible:ring-ring/50'],
  [/focus:border-blue-500/g, 'focus-visible:border-ring'],
  [/focus-visible:ring-blue-500/g, 'focus-visible:ring-ring/50'],
  [/focus-visible:ring-emerald-500/g, 'focus-visible:ring-ring/50'],
  [/focus-visible:ring-\[#3b5d94\]/g, 'focus-visible:ring-ring/50'],

  // Primary CTAs (sky/blue buttons)
  [/bg-sky-700/g, 'bg-primary'],
  [/bg-sky-600/g, 'bg-primary'],
  [/bg-sky-500/g, 'bg-primary'],
  [/hover:bg-sky-700/g, 'hover:bg-primary/90'],
  [/hover:bg-sky-600/g, 'hover:bg-primary/90'],
  [/active:bg-sky-700/g, 'active:bg-primary/90'],
  [/disabled:bg-sky-300/g, 'disabled:opacity-50'],
  [/text-sky-700/g, 'text-primary'],
  [/text-sky-600/g, 'text-primary'],
  [/bg-sky-50/g, 'bg-accent'],
  [/border-sky-200/g, 'border-border'],
  [/hover:bg-sky-50/g, 'hover:bg-accent'],
  [/hover:text-sky-700/g, 'hover:text-primary'],

  // Blue links
  [/text-blue-700/g, 'text-primary'],
  [/text-blue-600/g, 'text-primary'],
  [/hover:text-blue-700/g, 'hover:text-primary'],
  [/hover:text-blue-600/g, 'hover:text-primary'],

  // Success/stock (emerald -> success token)
  [/bg-emerald-600/g, 'bg-success'],
  [/bg-emerald-700/g, 'bg-success'],
  [/hover:bg-emerald-700/g, 'hover:bg-success/90'],
  [/hover:bg-emerald-600/g, 'hover:bg-success/90'],
  [/text-emerald-700/g, 'text-success'],
  [/text-emerald-600/g, 'text-success'],
  [/bg-emerald-50/g, 'bg-success/10'],
  [/border-emerald-200/g, 'border-success/20'],

  // Error/warning
  [/text-red-600/g, 'text-destructive'],
  [/text-red-500/g, 'text-destructive'],
  [/text-amber-700/g, 'text-warning'],
  [/text-amber-600/g, 'text-warning'],
  [/bg-amber-50/g, 'bg-warning/10'],
  [/bg-red-50/g, 'bg-destructive/10'],
  [/border-red-200/g, 'border-destructive/20'],
  [/border-amber-200/g, 'border-warning/20'],

  // Status pills (emerald/amber/rose)
  [/bg-emerald-100/g, 'bg-success/15'],
  [/text-emerald-800/g, 'text-success'],
  [/bg-amber-100/g, 'bg-warning/15'],
  [/text-amber-800/g, 'text-warning'],
  [/bg-rose-100/g, 'bg-destructive/15'],
  [/text-rose-800/g, 'text-destructive'],

  // Brand hex backgrounds -> primary
  [/bg-\[#0f75d8\]/g, 'bg-primary'],
  [/bg-\[#0088CC\]/g, 'bg-primary'],
  [/hover:bg-\[#0f75d8\]/g, 'hover:bg-primary/90'],

  // Rounded overrides to shadcn
  [/rounded-\[6px\]/g, 'rounded-md'],
  [/rounded-lg border/g, 'rounded-md border'],

  // h-10 form overrides (keep thumbnail/icon h-10)
  [/SelectTrigger className="h-10 /g, 'SelectTrigger className="'],
  [/SelectTrigger className=\{`h-10 /g, 'SelectTrigger className={`'],
  [/className="h-10 w-full rounded-md border border-input/g, 'className="w-full'],
  [/className="h-10 w-full rounded-lg border border-border/g, 'className="w-full'],
  [/className="h-10 rounded-md border border-border/g, 'className="'],
  [/className="h-10 border-border/g, 'className="border-border'],
  [/className="h-10 /g, 'className="'],
]

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (SKIP_DIRS.has(entry)) continue
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, files)
    } else if (
      (entry.endsWith('.tsx') || entry.endsWith('.ts')) &&
      !SKIP_FILES.has(entry) &&
      !full.includes('/components/ui/')
    ) {
      files.push(full)
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
