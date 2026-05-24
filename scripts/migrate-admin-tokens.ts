/**
 * Codemod: migrate admin files to shadcn semantic tokens.
 * Run: bun scripts/migrate-admin-tokens.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const ADMIN_DIRS = [
  join(ROOT, 'app/[locale]/admin'),
  join(ROOT, 'components/admin')
]
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist'])

const REPLACEMENTS: Array<[RegExp, string]> = [
  // Hex colors
  [/text-\[#0f172a\]/g, 'text-foreground'],
  [/text-\[#101828\]/g, 'text-foreground'],
  [/bg-\[#f8fafc\]/g, 'bg-muted'],
  [/bg-\[#101828\]/g, 'bg-primary'],
  [/hover:bg-\[#1d2939\]/g, 'hover:bg-primary/90'],
  [/bg-\[#0f172a\]/g, 'bg-primary'],
  [/hover:bg-\[#1e293b\]/g, 'hover:bg-primary/90'],

  // Primary button overrides -> remove (Button default handles it)
  [/ className="bg-primary hover:bg-primary\/90"/g, ''],
  [/ className="flex-1 bg-primary hover:bg-primary\/90"/g, ' className="flex-1"'],
  [/ className="w-full bg-primary hover:bg-primary\/90"/g, ' className="w-full"'],
  [/ className="h-9 bg-primary hover:bg-primary\/90"/g, ' className="h-9"'],

  // Slate/gray text
  [/text-slate-950/g, 'text-foreground'],
  [/text-slate-900/g, 'text-foreground'],
  [/text-slate-800/g, 'text-foreground'],
  [/text-slate-700/g, 'text-foreground'],
  [/text-slate-600/g, 'text-muted-foreground'],
  [/text-slate-500/g, 'text-muted-foreground'],
  [/text-slate-400/g, 'text-muted-foreground'],
  [/text-slate-300/g, 'text-muted-foreground/70'],
  [/text-gray-950/g, 'text-foreground'],
  [/text-gray-900/g, 'text-foreground'],
  [/text-gray-800/g, 'text-foreground'],
  [/text-gray-700/g, 'text-foreground'],
  [/text-gray-600/g, 'text-muted-foreground'],
  [/text-gray-500/g, 'text-muted-foreground'],
  [/text-gray-400/g, 'text-muted-foreground'],
  [/text-gray-300/g, 'text-muted-foreground/50'],

  // Backgrounds
  [/bg-slate-950/g, 'bg-foreground'],
  [/bg-slate-900/g, 'bg-primary'],
  [/bg-slate-400/g, 'bg-muted-foreground'],
  [/bg-slate-100/g, 'bg-muted'],
  [/bg-slate-50/g, 'bg-muted'],
  [/bg-gray-100/g, 'bg-muted'],
  [/bg-gray-50/g, 'bg-muted'],
  [/bg-white\/80/g, 'bg-card/80'],
  [/bg-white(?![/])/g, 'bg-background'],

  // Borders & dividers
  [/border-slate-300/g, 'border-input'],
  [/border-slate-200/g, 'border-border'],
  [/border-slate-100/g, 'border-border'],
  [/border-gray-300/g, 'border-input'],
  [/border-gray-200/g, 'border-border'],
  [/border-gray-100/g, 'border-border'],
  [/divide-slate-200/g, 'divide-border'],
  [/divide-slate-100/g, 'divide-border'],
  [/divide-slate-50/g, 'divide-border'],
  [/divide-gray-200/g, 'divide-border'],
  [/divide-gray-100/g, 'divide-border'],

  // Rings
  [/ring-slate-300/g, 'ring-border'],
  [/ring-slate-200\/60/g, 'ring-border/60'],
  [/ring-slate-500\/10/g, 'ring-muted-foreground/10'],
  [/ring-emerald-600\/10/g, 'ring-success/10'],
  [/ring-amber-600\/10/g, 'ring-warning/10'],
  [/ring-rose-600\/10/g, 'ring-destructive/10'],
  [/ring-blue-600\/10/g, 'ring-primary/10'],

  // Gradients
  [/from-slate-50 to-slate-100/g, 'from-muted to-muted'],
  [/from-blue-50 to-blue-100/g, 'from-accent to-accent'],
  [/from-emerald-50 to-emerald-100\/30/g, 'from-success/10 to-success/10'],
  [/from-emerald-50 to-emerald-100/g, 'from-success/10 to-success/10'],
  [/from-amber-50 to-amber-100\/30/g, 'from-warning/10 to-warning/10'],
  [/from-amber-50 to-amber-100/g, 'from-warning/10 to-warning/10'],
  [/from-rose-50 to-rose-100\/30/g, 'from-destructive/10 to-destructive/10'],
  [/from-rose-50 to-rose-100/g, 'from-destructive/10 to-destructive/10'],

  // Hover backgrounds
  [/hover:bg-slate-100/g, 'hover:bg-accent'],
  [/hover:bg-slate-50/g, 'hover:bg-accent'],
  [/hover:bg-gray-100/g, 'hover:bg-accent'],
  [/hover:bg-gray-50/g, 'hover:bg-accent'],
  [/hover:bg-gray-200/g, 'hover:bg-accent'],
  [/hover:bg-slate-800/g, 'hover:bg-primary/90'],
  [/hover:bg-slate-900/g, 'hover:bg-primary/90'],

  // Focus
  [/focus:border-slate-400/g, 'focus-visible:border-ring'],
  [/focus:ring-slate-200/g, 'focus-visible:ring-ring/50'],

  // Blue
  [/bg-blue-50\/50/g, 'bg-accent/50'],
  [/bg-blue-50/g, 'bg-accent'],
  [/bg-blue-100/g, 'bg-accent'],
  [/bg-blue-500/g, 'bg-primary'],
  [/text-blue-900/g, 'text-foreground'],
  [/text-blue-800/g, 'text-primary'],
  [/border-blue-100/g, 'border-border'],
  [/border-blue-200/g, 'border-border'],

  // Rose/destructive
  [/bg-rose-500/g, 'bg-destructive'],
  [/bg-rose-50/g, 'bg-destructive/10'],
  [/text-rose-900/g, 'text-destructive'],
  [/text-rose-800/g, 'text-destructive'],
  [/text-rose-700/g, 'text-destructive'],
  [/text-rose-600/g, 'text-destructive'],
  [/text-rose-500/g, 'text-destructive'],
  [/border-rose-200/g, 'border-destructive/20'],
  [/border-rose-100/g, 'border-destructive/20'],
  [/hover:text-rose-700/g, 'hover:text-destructive'],
  [/hover:text-rose-600/g, 'hover:text-destructive'],
  [/hover:bg-rose-50/g, 'hover:bg-destructive/10'],

  // Emerald/success
  [/text-emerald-900/g, 'text-success'],
  [/text-emerald-800/g, 'text-success'],
  [/text-emerald-700/g, 'text-success'],
  [/text-emerald-600/g, 'text-success'],
  [/text-emerald-500/g, 'text-success'],
  [/border-emerald-100/g, 'border-success/20'],
  [/border-emerald-200/g, 'border-success/20'],

  // Amber/warning
  [/text-amber-900/g, 'text-warning'],
  [/text-amber-800/g, 'text-warning'],
  [/text-amber-700/g, 'text-warning'],
  [/text-amber-600/g, 'text-warning'],
  [/text-amber-500/g, 'text-warning'],
  [/border-amber-100/g, 'border-warning/20'],
  [/border-amber-200/g, 'border-warning/20'],

  // Indigo card shadows -> semantic
  [/border-indigo-100\/50/g, 'border-border/50'],
  [/shadow-indigo-100\/50/g, 'shadow-sm'],

  // h-10 form overrides
  [/SelectTrigger className="h-10 /g, 'SelectTrigger className="'],
  [/SelectTrigger className=\{`h-10 /g, 'SelectTrigger className={`'],
  [/className="h-10 w-full rounded-md border border-input/g, 'className="w-full'],
  [/className="h-10 w-full rounded-lg border border-border/g, 'className="w-full'],
  [/className="h-10 rounded-md border border-border/g, 'className="'],
  [/className="h-10 border-border/g, 'className="border-border'],
  [/className="h-10 /g, 'className="'],
]

function walk(dir: string, files: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return files
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (SKIP_DIRS.has(entry)) continue
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, files)
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

let changedFiles = 0
let totalReplacements = 0

for (const adminDir of ADMIN_DIRS) {
  for (const file of walk(adminDir)) {
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
}

console.log(`\nDone: ${changedFiles} files, ~${totalReplacements} replacements`)
