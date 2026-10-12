"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Data-table behaviour (https://ui.shadcn.com/docs/components/base/data-table) for tables written as plain JSX.
// Inside <TableControls> (the admin layout) every table sorts from its header, filters from a header popover and
// searches from a toolbar, reading the values from the rendered cells; elsewhere the primitives render as stock.
// A paginated table holds only one page, so `server` hands sorting and filtering to the URL instead: TableHead's
// `sortKey` writes ?sort=&dir=, its `filter` writes its own parameter, and the page applies them in its query.

type SortDir = "asc" | "desc"
type ColumnFilter = { text: string; values: string[] }
type FilterOption = { value: string; label: string }
export type TableHeadFilter = { param: string; options?: FilterOption[]; placeholder?: string }

// Below CONTROL_ROWS rows a table is short enough to read; the toolbar search appears from SEARCH_ROWS rows.
const CONTROL_ROWS = 3
const SEARCH_ROWS = 8
const FACET_LIMIT = 12

const TableControlsContext = React.createContext(false)
const SectionContext = React.createContext<"head" | "body" | "foot" | null>(null)
const SlotContext = React.createContext<{ key: string; hidden: boolean } | null>(null)

type TableState = {
  server: boolean
  rows: number
  sort: { column: number; dir: SortDir } | null
  setSort: (sort: { column: number; dir: SortDir } | null) => void
  filters: Record<number, ColumnFilter>
  setFilter: (column: number, filter: ColumnFilter | null) => void
  values: Map<string, string[] | null>
  report: (slot: string, row: HTMLTableRowElement, values: string[] | null) => void
  release: (slot: string, row: HTMLTableRowElement) => void
  view: { order: string[] | null; hidden: Set<string>; shown: number; total: number; columns: number }
}
const TableContext = React.createContext<TableState | null>(null)

function TableControls({ children }: { children: React.ReactNode }) {
  return <TableControlsContext.Provider value>{children}</TableControlsContext.Provider>
}

const collator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" })
const normalize = (text: string) => text.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "")
const isEmpty = (text: string) => text === "" || text === "—" || text === "-"

// Turkish formatting: 1.234,56 ₺, %12, 12.10.2026 14:30. Anything else sorts as text.
function numeric(text: string): number | null {
  const date = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (date) return Date.UTC(+date[3], +date[2] - 1, +date[1], +(date[4] ?? 0), +(date[5] ?? 0), +(date[6] ?? 0))
  const plain = text.replace(/₺|TL|%|adet/gi, "").replace(/\s/g, "").replace("−", "-")
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(plain)) return null
  return Number(plain.replace(/\./g, "").replace(",", "."))
}

function compare(a: string, b: string) {
  const x = numeric(a), y = numeric(b)
  if (x !== null && y !== null) return x - y
  if (x !== null) return -1
  if (y !== null) return 1
  return collator.compare(a, b)
}

// The header's own words, without screen-reader-only text: an action column ("İşlem") gets no controls.
function labelOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelOf).join("")
  if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(node)) {
    if (node.props.className?.split(" ").includes("sr-only")) return ""
    return labelOf(node.props.children)
  }
  return ""
}

function bodyRowCount(children: React.ReactNode) {
  let count = 0
  React.Children.forEach(children, child => {
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === TableBody) count += React.Children.count(child.props.children)
  })
  return count
}

function readCells(row: HTMLTableRowElement): string[] | null {
  // A single cell across the table (an empty-state or detail row) is not data.
  if (row.cells.length === 1 && row.cells[0].colSpan > 1) return null
  const values: string[] = []
  for (const cell of Array.from(row.cells)) {
    const text = (cell.dataset.value ?? cell.textContent ?? "").replace(/\s+/g, " ").trim()
    for (let span = 0; span < cell.colSpan; span++) values.push(span ? "" : text)
  }
  return values
}

function columnIndex(cell: HTMLTableCellElement) {
  let index = 0
  for (let previous = cell.previousElementSibling; previous; previous = previous.previousElementSibling) index += (previous as HTMLTableCellElement).colSpan || 1
  return index
}

function Table({ className, children, server = false, controls = true, ...props }: React.ComponentProps<"table"> & {
  /** Sorting and filtering go to the URL (paginated tables); only heads with `sortKey` / `filter` get controls. */
  server?: boolean
  /** false renders the stock table. */
  controls?: boolean
}) {
  const enabled = React.useContext(TableControlsContext) && controls
  const ref = React.useRef<HTMLTableElement>(null)
  const [domRows, setDomRows] = React.useState(0)
  const rows = bodyRowCount(children) || domRows
  const [sort, setSort] = React.useState<TableState["sort"]>(null)
  const [filters, setFilters] = React.useState<Record<number, ColumnFilter>>({})
  const [search, setSearch] = React.useState("")
  const [values, setValues] = React.useState<Map<string, string[] | null>>(() => new Map())
  const owners = React.useRef(new Map<string, HTMLTableRowElement>())

  // Fallback when the body is not a direct child: count the rendered rows.
  React.useLayoutEffect(() => {
    if (!enabled || !ref.current) return
    let count = 0
    for (const body of Array.from(ref.current.tBodies)) count += body.rows.length
    setDomRows(count)
  }, [enabled])

  const report = React.useCallback((slot: string, row: HTMLTableRowElement, next: string[] | null) => {
    const owner = owners.current.get(slot)
    if (owner && owner !== row && owner.isConnected) return
    owners.current.set(slot, row)
    setValues(current => {
      const previous = current.get(slot)
      if (previous !== undefined && (previous === next || (previous && next && previous.length === next.length && previous.every((value, i) => value === next[i])))) return current
      return new Map(current).set(slot, next)
    })
  }, [])
  const release = React.useCallback((slot: string, row: HTMLTableRowElement) => {
    if (owners.current.get(slot) !== row) return
    owners.current.delete(slot)
    setValues(current => {
      if (!current.has(slot)) return current
      const next = new Map(current)
      next.delete(slot)
      return next
    })
  }, [])
  const setFilter = React.useCallback((column: number, filter: ColumnFilter | null) => setFilters(current => {
    const next = { ...current }
    if (filter && (filter.text.trim() || filter.values.length)) next[column] = filter
    else delete next[column]
    return next
  }), [])

  const view = React.useMemo(() => {
    const data = [...values].filter((entry): entry is [string, string[]] => entry[1] !== null)
    const columns = data.reduce((max, [, row]) => Math.max(max, row.length), 0)
    const needle = normalize(search.trim())
    const active = Object.entries(filters).map(([column, filter]) => ({ column: Number(column), text: normalize(filter.text.trim()), values: new Set(filter.values) }))
    const hidden = new Set<string>()
    for (const [slot, row] of data) {
      const passes = active.every(filter => {
        const value = row[filter.column] ?? ""
        return (!filter.values.size || filter.values.has(value)) && (!filter.text || normalize(value).includes(filter.text))
      })
      if (!passes || (needle && !row.some(value => normalize(value).includes(needle)))) hidden.add(slot)
    }
    let order: string[] | null = null
    if (sort) {
      const sign = sort.dir === "asc" ? 1 : -1
      order = data.map(([slot]) => slot).sort((a, b) => {
        const x = values.get(a)?.[sort.column] ?? "", y = values.get(b)?.[sort.column] ?? ""
        // Empty cells stay last in both directions.
        if (isEmpty(x) || isEmpty(y)) return Number(isEmpty(x)) - Number(isEmpty(y))
        return sign * compare(x, y)
      })
    }
    return { order, hidden, shown: data.length - hidden.size, total: data.length, columns }
  }, [values, filters, search, sort])

  const state = React.useMemo<TableState>(() => ({ server, rows, sort, setSort, filters, setFilter, values, report, release, view }),
    [server, rows, sort, filters, setFilter, values, report, release, view])
  const filtered = Boolean(search.trim()) || Object.keys(filters).length > 0
  const reset = () => { setSearch(""); setFilters({}); setSort(null) }

  const table = (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        ref={ref}
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  )

  // A table nested in a cell (a details dialog) starts its own row slots and sections.
  return (
    <TableContext.Provider value={enabled ? state : null}>
      <SlotContext.Provider value={null}>
        <SectionContext.Provider value={null}>
          {enabled && !server && (rows >= SEARCH_ROWS || filtered) && (
            <div data-slot="table-toolbar" className="flex flex-wrap items-center gap-2 pb-3">
              <InputGroup className="w-full sm:w-64">
                <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tabloda ara" aria-label="Tabloda ara" />
                {search && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="Aramayı temizle" onClick={() => setSearch("")}><X /></InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              {filtered && (
                <>
                  <span className="text-sm text-muted-foreground tabular-nums" role="status">{view.shown} / {view.total} satır</span>
                  <Button variant="ghost" size="sm" onClick={reset}><X data-icon="inline-start" aria-hidden="true" />Filtreleri temizle</Button>
                </>
              )}
            </div>
          )}
          {table}
        </SectionContext.Provider>
      </SlotContext.Provider>
    </TableContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <SectionContext.Provider value="head">
      <thead
        data-slot="table-header"
        className={cn("[&_tr]:border-b", className)}
        {...props}
      />
    </SectionContext.Provider>
  )
}

function TableBody({ className, children, ...props }: React.ComponentProps<"tbody">) {
  const table = React.useContext(TableContext)
  return (
    <SectionContext.Provider value="body">
      <tbody
        data-slot="table-body"
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
      >
        {table && !table.server && table.rows >= CONTROL_ROWS ? <BodyRows table={table}>{children}</BodyRows> : children}
      </tbody>
    </SectionContext.Provider>
  )
}

// Each top-level child is one unit (a row, or a wrapper holding its row and any detail row): sorted and hidden whole.
function BodyRows({ table, children }: { table: TableState; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(React.isValidElement)
  const byKey = new Map(items.map(item => [String(item.key), item]))
  const keys = [...byKey.keys()]
  let order = keys
  if (table.view.order) {
    const sorted = table.view.order.filter(key => byKey.has(key))
    const placed = new Set(sorted)
    order = [...sorted, ...keys.filter(key => !placed.has(key))]
  }
  return (
    <>
      {order.map(key => (
        <SlotContext.Provider key={key} value={{ key, hidden: table.view.hidden.has(key) }}>{byKey.get(key)}</SlotContext.Provider>
      ))}
      {table.view.total > 0 && table.view.shown === 0 && (
        <TableRow>
          <TableCell colSpan={table.view.columns} className="h-24 text-center text-muted-foreground">Eşleşen satır yok.</TableCell>
        </TableRow>
      )}
    </>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <SectionContext.Provider value="foot">
      <tfoot
        data-slot="table-footer"
        className={cn(
          "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
          className
        )}
        {...props}
      />
    </SectionContext.Provider>
  )
}

function TableRow({ className, hidden, ...props }: React.ComponentProps<"tr">) {
  const table = React.useContext(TableContext)
  const slot = React.useContext(SlotContext)
  const ref = React.useRef<HTMLTableRowElement>(null)
  const report = table?.report, release = table?.release, key = slot?.key

  // Re-read after every render: a server refresh changes cell text without changing the row's key.
  React.useLayoutEffect(() => {
    if (report && key && ref.current) report(key, ref.current, readCells(ref.current))
  })
  React.useEffect(() => {
    const row = ref.current
    return () => { if (release && key && row) release(key, row) }
  }, [release, key])

  return (
    <tr
      ref={ref}
      data-slot="table-row"
      hidden={hidden || slot?.hidden || undefined}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, sortKey, filter, ...props }: React.ComponentProps<"th"> & {
  /** Server tables: the ?sort= value this column orders by. */
  sortKey?: string
  /** Server tables: the URL parameter this column filters by, with its choices when it has a fixed set. */
  filter?: TableHeadFilter
}) {
  const table = React.useContext(TableContext)
  const section = React.useContext(SectionContext)
  const ref = React.useRef<HTMLTableCellElement>(null)
  const [column, setColumn] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    if (ref.current) setColumn(columnIndex(ref.current))
  }, [])

  const label = labelOf(children).trim()
  const align = className?.includes("text-right") ? "end" : className?.includes("text-center") ? "center" : "start"
  let content = children
  let ariaSort: React.AriaAttributes["aria-sort"]
  if (table && section === "head" && label) {
    if (table.server) {
      if (sortKey || filter) content = (
        <React.Suspense fallback={children}>
          <ServerHead label={label} align={align} sortKey={sortKey} filter={filter}>{children}</ServerHead>
        </React.Suspense>
      )
    } else if (table.rows >= CONTROL_ROWS) {
      const sorted = column !== null && table.sort?.column === column ? table.sort.dir : null
      ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
      content = <ClientHead table={table} column={column} label={label} align={align} sorted={sorted}>{children}</ClientHead>
    }
  }

  return (
    <th
      ref={ref}
      data-slot="table-head"
      aria-sort={ariaSort}
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {content}
    </th>
  )
}

function HeadLayout({ align, children }: { align: "start" | "center" | "end"; children: React.ReactNode }) {
  return <div className={cn("flex items-center gap-0.5", align === "end" && "justify-end", align === "center" && "justify-center")}>{children}</div>
}

function SortButton({ label, sorted, onClick, children }: { label: string; sorted: SortDir | null; onClick: () => void; children: React.ReactNode }) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown
  const next = sorted === "asc" ? "Z→A sırala" : sorted === "desc" ? "Sıralamayı kaldır" : "A→Z sırala"
  return (
    <Button variant="ghost" size="sm" className="-mx-2" onClick={onClick} aria-label={`${label}: ${next}`} title={next}>
      {children}
      <Icon data-icon="inline-end" aria-hidden="true" className={cn(!sorted && "text-muted-foreground")} />
    </Button>
  )
}

function FilterTrigger({ label, active }: { label: string; active: boolean }) {
  return (
    <PopoverTrigger render={<Button variant={active ? "secondary" : "ghost"} size="icon-xs" aria-label={`${label} filtresi${active ? " (etkin)" : ""}`} title="Filtrele" />}>
      <ListFilter aria-hidden="true" className={cn(!active && "text-muted-foreground")} />
    </PopoverTrigger>
  )
}

function ClientHead({ table, column, label, align, sorted, children }: {
  table: TableState; column: number | null; label: string; align: "start" | "center" | "end"; sorted: SortDir | null; children: React.ReactNode
}) {
  const filter = column === null ? undefined : table.filters[column]
  const cycle = () => {
    if (column === null) return
    table.setSort(sorted === "asc" ? { column, dir: "desc" } : sorted === "desc" ? null : { column, dir: "asc" })
  }
  return (
    <HeadLayout align={align}>
      <SortButton label={label} sorted={sorted} onClick={cycle}>{children}</SortButton>
      <Popover>
        <FilterTrigger label={label} active={Boolean(filter)} />
        <PopoverContent align={align === "end" ? "end" : "start"} className="w-64">
          {column !== null && <ClientFilter table={table} column={column} label={label} filter={filter} />}
        </PopoverContent>
      </Popover>
    </HeadLayout>
  )
}

function ClientFilter({ table, column, label, filter }: { table: TableState; column: number; label: string; filter: ColumnFilter | undefined }) {
  const current = filter ?? { text: "", values: [] }
  // A short list of distinct values (status, supplier, stock) is offered as checkboxes.
  const facets = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of table.values.values()) if (row) {
      const value = row[column] ?? ""
      if (!isEmpty(value)) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    if (counts.size < 2 || counts.size > FACET_LIMIT || counts.size === table.view.total) return null
    return [...counts].sort((a, b) => compare(a[0], b[0]))
  }, [table.values, table.view.total, column])
  const toggle = (value: string, checked: boolean) =>
    table.setFilter(column, { ...current, values: checked ? [...current.values, value] : current.values.filter(item => item !== value) })

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput autoFocus value={current.text} onChange={event => table.setFilter(column, { ...current, text: event.target.value })} placeholder="İçeren…" aria-label={`${label} içeren`} />
      </InputGroup>
      {facets && (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {facets.map(([value, count]) => (
            <label key={value} className="flex items-center gap-2 rounded-md p-1 hover:bg-muted">
              <Checkbox checked={current.values.includes(value)} onCheckedChange={checked => toggle(value, checked)} />
              <span className="truncate">{value}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{count}</span>
            </label>
          ))}
        </div>
      )}
      {filter && <Button variant="ghost" size="sm" onClick={() => table.setFilter(column, null)}><X data-icon="inline-start" aria-hidden="true" />Filtreyi temizle</Button>}
    </div>
  )
}

function ServerHead({ label, align, sortKey, filter, children }: {
  label: string; align: "start" | "center" | "end"; sortKey?: string; filter?: TableHeadFilter; children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  // Any change starts again from page 1; the other parameters (tab, search, filters) are kept.
  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    next.delete("page")
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    startTransition(() => router.push(next.size ? `${pathname}?${next}` : pathname, { scroll: false }))
  }
  const sorted = sortKey && params.get("sort") === sortKey ? (params.get("dir") === "desc" ? "desc" : "asc") : null
  const value = filter ? params.get(filter.param) ?? "" : ""

  return (
    <HeadLayout align={align}>
      {sortKey ? (
        <SortButton label={label} sorted={sorted} onClick={() => navigate(sorted === "asc"
          ? { sort: sortKey, dir: "desc" } : sorted === "desc" ? { sort: null, dir: null } : { sort: sortKey, dir: "asc" })}>
          {children}
        </SortButton>
      ) : children}
      {filter && (
        <Popover>
          <FilterTrigger label={label} active={Boolean(value)} />
          <PopoverContent align={align === "end" ? "end" : "start"} className="w-64">
            {filter.options ? (
              <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                {[{ value: "", label: "Tümü" }, ...filter.options].map(option => (
                  <label key={option.value} className="flex items-center gap-2 rounded-md p-1 hover:bg-muted">
                    <Checkbox checked={value === option.value} disabled={pending} onCheckedChange={() => navigate({ [filter.param]: option.value || null })} />
                    <span className="truncate">{option.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <form className="flex flex-col gap-2" onSubmit={event => {
                event.preventDefault()
                navigate({ [filter.param]: String(new FormData(event.currentTarget).get("value") ?? "").trim() || null })
              }}>
                <InputGroup>
                  <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                  <InputGroupInput name="value" autoFocus defaultValue={value} placeholder={filter.placeholder ?? "İçeren…"} aria-label={`${label} filtresi`} />
                </InputGroup>
                <div className="flex justify-end gap-2">
                  {value && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => navigate({ [filter.param]: null })}>Temizle</Button>}
                  <Button type="submit" size="sm" disabled={pending}>Uygula</Button>
                </div>
              </form>
            )}
          </PopoverContent>
        </Popover>
      )}
    </HeadLayout>
  )
}

function TableCell({ className, value, ...props }: React.ComponentProps<"td"> & {
  /** What sorting and filtering read instead of the cell's text (e.g. a raw number behind a formatted one). */
  value?: string | number
}) {
  return (
    <td
      data-slot="table-cell"
      data-value={value}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableControls,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
