#!/usr/bin/env node
// Upfront context per Claude Code session and per subagent type for this repo (#1086).
// Reads the local transcripts (~/.claude/projects/<repo>/**.jsonl) and reports the
// first assistant turn's input + cache read + cache creation tokens — i.e. what every
// session/agent pays before doing any work. Usage: node scripts/harness/context-usage.mjs [since=YYYY-MM-DD]
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const since = process.argv[2] ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
const root = join(homedir(), ".claude/projects", process.cwd().replaceAll("/", "-").replace(/-getirbakim-\d+$/, "-getirbakim"))

function firstContext(file) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const usage = entry.type === "assistant" ? entry.message?.usage : undefined
    if (usage) {
      const total = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      return { at: entry.timestamp ?? "", total }
    }
  }
  return undefined
}

const groups = new Map()
const add = (name, value) => groups.set(name, [...(groups.get(name) ?? []), value])
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { walk(path); continue }
    if (!entry.name.endsWith(".jsonl")) continue
    const first = firstContext(path)
    if (!first || first.at < since) continue
    if (!path.includes("/subagents/")) { add("main session", first.total); continue }
    const meta = path.replace(/\.jsonl$/, ".meta.json")
    const type = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")).agentType ?? "?" : "?"
    add(type, first.total)
  }
}
if (!existsSync(root)) { console.error(`no transcripts at ${root}`); process.exit(1) }
walk(root)
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
console.log(`upfront context since ${since} (tokens, first turn)`)
for (const [name, values] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${name.padEnd(24)} n=${String(values.length).padStart(4)}  median=${String(median(values)).padStart(7)}  min=${String(Math.min(...values)).padStart(7)}`)
}
