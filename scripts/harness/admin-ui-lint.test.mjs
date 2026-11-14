import assert from "node:assert/strict"
import { test } from "node:test"
import { lintSource } from "./admin-ui-lint.mjs"

const rules = (source) => lintSource(source).map((f) => f.rule)

test("flags inline styles, arbitrary values and arbitrary variants", () => {
  assert.deepEqual(rules('<div style={{ width: 4 }} />'), ["inline-style"])
  assert.deepEqual(rules('<div className="w-[45%] gap-2" />'), ["arbitrary-value"])
  assert.deepEqual(rules('<div className="min-w-[28rem]" />'), ["arbitrary-value"])
  assert.ok(rules('<div className="[&>svg]:size-4" />').includes("arbitrary-variant"))
})

test("flags hex, raw palette, black/white and dark: colour overrides", () => {
  assert.deepEqual(rules('const c = "#0f62fe"'), ["hex-color"])
  assert.deepEqual(rules('<p className="text-emerald-600" />'), ["palette-color"])
  assert.deepEqual(rules('<p className="hover:bg-slate-100" />'), ["palette-color"])
  assert.deepEqual(rules('<p className="text-white" />'), ["black-white"])
  assert.deepEqual(rules('<p className="dark:text-gray-300" />').sort(), ["dark-variant", "palette-color"])
})

test("allows tokens, layout classes and theme-dependent visibility", () => {
  assert.deepEqual(rules('<p className="text-muted-foreground text-success tabular-nums" />'), [])
  assert.deepEqual(rules('<div className="grid gap-4 md:grid-cols-2 max-w-7xl w-1/2 truncate" />'), [])
  assert.deepEqual(rules('<Sun className="dark:hidden" /><Moon className="hidden dark:block" />'), [])
  assert.deepEqual(rules('<Badge variant="success" />'), [])
})

test("ignores issue references in comments and the escape hatch", () => {
  assert.deepEqual(rules("  /** Restock requests (#475). */"), [])
  assert.deepEqual(rules("// fixed in #480"), [])
  assert.deepEqual(rules('<p>{/* #482 */}Metin</p>'), [])
  assert.deepEqual(rules('<div style={{ x: 1 }} /> {/* admin-ui-lint-ignore: chart lib needs it */}'), [])
})

test("corner/shadow changes are warnings, only inside class contexts", () => {
  const [finding] = lintSource('<Accordion className="rounded-lg border" />')
  assert.equal(finding.rule, "restyle")
  assert.equal(finding.severity, "warning")
  assert.deepEqual(rules('const label = "rounded total"'), [])
  assert.deepEqual(rules('className={cn(\n  "gap-2",\n  "shadow-sm",\n)}'), ["restyle"])
})

test("flags legacy wrappers, the shadcn cn import and stylesheets", () => {
  assert.deepEqual(rules('import { Card } from "@/components/admin/ui"'), ["legacy-admin-ui"])
  assert.deepEqual(rules('import { cn } from "cn"'), ["shadcn-cn-import"])
  assert.deepEqual(rules('import "./admin.css"'), ["css-import"])
  assert.deepEqual(rules('import { cn } from "@/lib/utils"'), [])
})
