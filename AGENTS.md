<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Development, versioning and release rules

Full policy: [docs/development-workflow.md](docs/development-workflow.md) (Turkish) — read it before release work, `db/*.sql` changes, labelling, or anything not covered here. The user's current task-specific instruction wins. Reply to the user in Turkish; commits, PRs and code stay English.

- Default flow: local survey → separate worktree from fresh `origin/dev` → GitHub Issue (before changing files) → implement/verify → PR linked to the Issue → merge into `dev` once CI is green. Unless the user asked for another target or to wait, finish this flow without asking again.
- Protect other work's files and worktrees; a PR contains only this work's changes.
- Conventional Commits for commit/PR titles; Issue/PR labels per the guide: type, area, and release impact when needed.
- No version tag per commit/PR. When the user asks for a `main` release, version notable features as `feat` / MINOR, update manifests and changelog, put an annotated `vX.Y.Z` tag on the `main` release commit.
- **`main` = releasable version.** Before any push to `main`, `dev → main` merge or anything that changes `main`, get the user's **explicit approval** (show version number and scope). An earlier approval does not cover the next release.
- **AWS production (getirbakim.com) release is a separate, manually triggered step:** the `release-aws.yml` workflow on `main` (`workflow_dispatch`, `-f version=<package.json version>`; its guard job stops a non-`main` branch, a trigger by anyone but the repo owner, or a mismatched version before AWS is touched). Merging to `main` does not deploy; trigger the workflow only with the user's separate, explicit release approval.
- Development happens only via `dev`; mature work reaches `main` only as a versioned release. No direct commits or hotfix pushes to `main`; urgent fixes also go `dev` → release PR.
- No automatic Contabo deploy; no staging (separate user request). CI is mandatory; do not change/enable deploy workflows or staging without an explicit request.
- When done, report Issue/PR links, verification and merge status; add version/tag info if any.

## Agent harness (Claude Code)

Developments go through a fixed multi-agent pipeline: [`docs/harness/README.md`](docs/harness/README.md). With the `/ship <issue>` skill the main session becomes the **orchestrator** and hands work to `getirbakim-planner` → `getirbakim-developer` → `getirbakim-reviewer` + `getirbakim-ui-ux` → `getirbakim-qa` in `.claude/agents/`. Other skills: `/issue`, `/qa`, `/design-check`, `/backlog`, `/release-check`. Deterministic checks live in `scripts/harness/` (`admin-ui-lint.mjs`: post-edit hook, `npm run harness:lint`, CI); flow hooks in `scripts/flow/` (session brief, `dev`/`main` guard; `.claude/settings.json`).

## Admin panel (/yonetim) UI rule

`/yonetim` and `src/components/admin/**` are built only from stock shadcn/ui components and their variants (Card, Table, Badge, Alert, Empty, Tabs, Pagination, Field, InputGroup, Item, Dialog, Sidebar…; full list in `src/components/ui`).

- No custom CSS files, `style={}`, arbitrary Tailwind values (`rounded-[4px]`, `w-[45%]`, `min-w-[28rem]`), hex colours, or re-colouring / changing corners / shadows of components via className. No wrapper "design system" components (the old `components/admin/ui`) come back.
- className is only for layout and spacing (flex/grid/gap/p/m/w/max-w-7xl/truncate/tabular-nums, responsive prefixes) and token-bound typography/colour (`text-muted-foreground`, `text-2xl font-semibold tracking-tight`, `text-success` / `text-warning` / `text-destructive` / `text-info` on plain text and icons).
- Colour language is IBM Carbon (VoltAgent/awesome-design-md `design-md/ibm`): IBM Blue primary, grey neutrals, 4px corners; tokens in `src/app/admin.css` under `.admin-app` (light = g10, dark = g100). States differ by colour, but the text must carry the meaning too:
  - Badge/Alert variants: `success` (positive: in stock, healthy, succeeded, paid, increase), `warning` (attention: no data, pending, partial, stale data), `destructive` (negative: error, cancelled, failed, decrease, out of stock when needed), `info` (informational/in progress), `outline`/`secondary` (neutral).
  - Add a fitting lucide icon to Badges with `data-icon="inline-start"` (CircleCheck, TriangleAlert, CircleAlert, Info).
- A framed Accordion (detail/history blocks) uses `<Card size="sm" className="py-0"><CardContent><Accordion>` (#520); corners and shadow come from the Card itself, no `rounded-*`/`border`. Corner classes in stock sidebar blocks (logo tile, NavUser avatar) carry a justified inline `admin-ui-lint-ignore`.
- `src/components/ui/*` stays as delivered by the registry; deliberate additions are the `success` / `warning` / `info` variants of Badge and Alert, the data-table behaviour of `ui/table.tsx`, and Turkish screen-reader/default texts in stock components (Kapat, Yükleniyor, Önceki/Sonraki…). When a new registry component is added, translate its English texts to Turkish the same way.
- Tables (`ui/table.tsx`, shadcn data-table layout): under `TableControls` in the `/yonetim` layout every table sorts A→Z/Z→A from its header, filters via the header filter button, and gets a toolbar search at 8+ rows; values are read from cell text (use `TableCell value` if needed). Storefront tables are unaffected. Paginated tables use `<Table server>`: only headers with `TableHead sortKey` (→ `?sort=&dir=`, `sortOrder()` from `src/lib/table-sort.ts` in the query) and `filter={{ param, options }}` get controls; the page's link/form builders must carry `sort`/`dir`. Use `controls={false}` when not needed. No per-page TanStack tables. Add a missing component with `npx shadcn@latest add` (change the CLI's `import { cn } from "cn"` → `@/lib/utils`).
- Stylesheets (#1027): `src/app/globals.css` scans only storefront sources, `src/app/admin.css` (imported by the `/yonetim` layout) adds the workspace utilities and `.admin-app` tokens. A registry component only `/yonetim` uses goes into the `@source not` list in `globals.css` (`npm run test:stylesheet-scope` checks it); when a storefront page starts importing an excluded ui file, remove it from that list (the test says so). Theme keys the CLI adds go to `src/app/theme.css`.
- Base UI: render a Link as a Button with `<Button nativeButton={false} render={<Link href/>}>`. Stock `PaginationPrevious/Next` emit a plain `<a>`; for client navigation use this Link-Button inside `PaginationItem`. Wrap an overflowing `TabsList` in `ScrollArea` + horizontal `ScrollBar`.
