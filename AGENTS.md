# AGENTS.md

## Project context
This repository is an e-commerce application focused on automotive spare parts.
Core concerns of the project may include:
- product search
- vehicle compatibility
- VIN-based vehicle identification
- part-to-vehicle matching
- API integrations with suppliers or catalog systems
- pricing, stock, and product detail synchronization
- frontend UX for search and category navigation
- backend reliability and data consistency

The codebase should be treated as production-oriented.
Prefer maintainability, correctness, and minimal risk over unnecessary cleverness.

---

## Global working principles

- First understand the task and inspect the relevant code before changing anything.
- For any non-trivial task, create a short plan.
- Prefer the smallest effective change.
- Preserve existing architecture, naming, conventions, and folder structure.
- Do not introduce broad refactors unless they are required for correctness.
- Do not make speculative changes without evidence from the repository.
- State assumptions explicitly.
- If there is uncertainty, inspect more code rather than guessing.
- Keep implementations easy to review.
- Optimize for correctness, maintainability, and low regression risk.

---

## Engineering priorities

When making decisions, prioritize in this order:
1. correctness
2. regression safety
3. consistency with existing architecture
4. readability
5. performance
6. speed of implementation

Do not sacrifice correctness for speed.

---

## Preferred workflow

For non-trivial tasks, use this sequence:

1. Research Agent
2. Coding Agent
3. Debug Agent if needed
4. Review Agent before finalization

For simple tasks, use only the minimum number of agents needed.

Examples:
- New feature: Research -> Coding -> Review
- Bug fix: Research -> Debug -> Coding -> Review
- Codebase understanding: Research only
- Failing test investigation: Research -> Debug -> Review
- Small isolated edit: Coding -> Review

---

## Agent roles

### Research Agent
Use Research Agent for:
- repository exploration
- finding relevant files and entry points
- tracing request flow, data flow, and dependencies
- understanding existing behavior
- identifying conventions and constraints
- reading related tests, docs, and configs

Research Agent should not implement code unless explicitly asked.

Research Agent deliverables:
- relevant files
- current behavior summary
- request/data/call flow summary
- constraints and assumptions
- recommended implementation approach
- risks or unclear areas

### Coding Agent
Use Coding Agent for:
- implementing features
- making minimal code changes
- updating existing logic
- adding or adjusting tests where appropriate
- keeping code aligned with current project style

Coding Agent rules:
- make the smallest effective change
- avoid unrelated cleanup
- avoid hidden behavior changes
- preserve backwards compatibility unless the task explicitly changes behavior

Coding Agent deliverables:
- files changed
- implementation summary
- why this approach was chosen
- any required follow-up work

### Debug Agent
Use Debug Agent for:
- reproducing bugs
- investigating failing tests
- examining logs, stack traces, and runtime paths
- separating symptoms from root causes
- identifying missing guards, assumptions, and edge cases

Debug Agent rules:
- identify root cause before proposing fixes
- do not patch blindly
- prefer evidence from code, logs, or tests
- highlight regression risks

Debug Agent deliverables:
- reproduction status
- root cause
- supporting evidence
- proposed minimal fix
- regression risks
- suggested tests

### Review Agent
Use Review Agent for:
- final diff review
- checking correctness
- edge-case analysis
- regression risk analysis
- checking test coverage gaps
- checking whether implementation matches the task

Review Agent rules:
- be critical and practical
- flag overengineering
- flag incomplete validation
- suggest only high-value improvements

Review Agent deliverables:
- review summary
- correctness concerns
- edge cases
- regression risks
- test gaps
- approval recommendation

---

## Domain-specific guidance

### Automotive spare parts domain
Treat automotive compatibility logic as high-risk.
Be careful with:
- vehicle-to-part matching
- VIN decoding and VIN-based filtering
- engine / chassis / model year distinctions
- OEM / aftermarket equivalence assumptions
- incompatible substitutions
- variant-specific fitment logic

Never assume compatibility rules without evidence from the code or task requirements.

If a feature touches compatibility logic, explicitly identify:
- where compatibility is determined
- which attributes are used
- where incorrect matching could happen
- what the failure mode would be for the customer

### VIN-related work
When working on VIN features:
- trace VIN input from UI to backend to data source
- identify validation logic
- identify external integrations or decoding services
- verify how decoded vehicle data is mapped into internal structures
- check fallback behavior when VIN decoding is incomplete or fails
- be careful with country/market/version differences

### Search-related work
When working on product search:
- identify search source and ranking logic
- inspect filters, normalization, tokenization, and typo handling
- preserve relevance behavior unless task requires changing it
- be careful with performance-sensitive queries
- explicitly note whether behavior affects search accuracy, latency, or conversion

### Supplier / stock / pricing integrations
When working on external integrations:
- identify source-of-truth ownership
- avoid silent data shape changes
- preserve retry/error handling behavior
- validate null/partial/malformed responses
- note whether the change affects stock accuracy, pricing accuracy, or sync stability

---

## Frontend guidance

For frontend changes:
- preserve existing UI patterns and component conventions
- avoid large visual rewrites unless asked
- prioritize clarity and speed for commerce flows
- be careful with hydration issues, async state, and client/server boundaries
- keep forms resilient to partial failures
- validate loading, empty, and error states
- be explicit when a change affects SEO, filtering UX, or conversion behavior

If using Next.js:
- respect server vs client component boundaries
- avoid unnecessary client-side state if server-side rendering is sufficient
- do not move logic across boundaries without a clear reason
- inspect route handlers, server actions, and data fetching paths before modifying them

---

## Backend guidance

For backend changes:
- preserve API contracts unless task explicitly changes them
- check consumers before changing response shapes
- validate inputs defensively
- prefer explicit error handling
- be careful with concurrency, caching, and stale data
- identify whether the code is latency-sensitive or consistency-sensitive

If a change affects inventory, price, order flow, or compatibility, call out the business risk explicitly.

---

## Database and data model guidance

- Do not rename fields or change schema assumptions casually.
- Inspect how a model is read and written before changing it.
- Watch for hidden coupling across product, vehicle, compatibility, stock, and pricing tables.
- If migrations are needed, keep them minimal and reversible where possible.
- Explicitly note any backfill, migration, or data consistency risk.

### Banned commands

`prisma migrate dev`, `prisma migrate reset` and `prisma db push` must never be
run against any database in this project — local included, local especially.

They reconcile the dev database by dropping whatever does not match the
datamodel. Local `public` holds a 129 GB TecDoc archive (`part_vehicle_types`
alone is ~931M rows) that exists in no other environment and no backup, local has
no `_prisma_migrations` table, and `migrate diff` currently reports 12 stray
indexes plus a `parts.part_no` text→bigint rewrite waiting to fire.

Use instead:

```bash
bun run db:target          # which database am I pointed at?
bun run db:diff:check      # is the target in sync with schema.prisma? (exit 0 = yes)
bun run db:migration:new <name>   # author a migration via a throwaway shadow DB
bun run db:migrate         # prisma migrate deploy
bun run db:status          # prisma migrate status
```

`scripts/db-migration-new.sh` replays the committed migration history into a
disposable shadow database and diffs that against `schema.prisma`, so the dev
database is never inspected or modified.

### Schema and data ownership

- **Schema flows one way**: `schema.prisma` → migration → `migrate deploy` → prod.
  Local and prod must stay *structurally identical*; differences belong in data,
  never in structure. An empty table in an environment costs nothing; a
  structural difference breaks the next deploy.
- **Writes to prod have exactly two channels**: `prisma migrate deploy`, and
  idempotent additive scripts (`INSERT ... ON CONFLICT DO NOTHING`, scoped by the
  `source` column, never `DELETE`/`TRUNCATE`). No ad-hoc `psql` writes.
- **Never move `catalog` rows between environments by id.** `catalog.products.id`
  values are *not* aligned between local and prod — sampled ids 100k/500k/900k
  resolve to entirely different products. Match on the natural key (brand +
  normalised part number) or re-derive in place.
- Manual edits made by the team in the admin UI (`product_overrides`,
  `source='MANUAL'` rows, `brand_mappings`) are authoritative. Any script that
  touches those tables must leave them untouched.

---

## Testing and validation

Run the smallest useful validation first, then broader checks if needed.

Validation priority:
1. typecheck / lint for touched code
2. narrow tests related to the change
3. broader test suites if the change is high-risk
4. Docker build verification (`docker compose -f docker-compose.local.yml up -d --build`)
5. manual reasoning about untested edge cases

When validating:
- prefer targeted checks over expensive blanket runs at first
- if tests cannot be run, explain why
- do not claim confidence without evidence
- mention what was validated and what was not

### Docker Build

A full Docker build (`docker compose -f docker-compose.local.yml up -d --build`) is **not required** for every change.

For routine development:

```bash
# Terminal 1: Start dependencies (PostgreSQL + Meilisearch) in Docker
bun run dev:deps

# Terminal 2: Start Next.js dev server with HMR
bun run dev
```

This is faster than Docker build and provides Hot Module Replacement.

**When to run a full Docker build:**

Run `bun run dev:docker` before deployment or when:
- Modifying `Dockerfile`, `next.config.mjs`, or `docker-compose*.yml`
- Adding/modifying dependencies in `package.json`
- Making changes that could break production build (e.g., Node-specific APIs, `fs`, `path`)
- Prisma schema changes (to verify `prisma generate` at build time)
- You want to verify the production build behaves correctly

After a Docker build, verify health:
```bash
curl -s http://localhost:3001/api/health | grep '"status":"ok"'
```

Why dev (`bun run dev`) sometimes misses issues:
- Next.js dev uses Turbopack; production build uses Webpack.
- Dynamic requires or Node-specific APIs may work in dev but fail in production.
- Static generation and middleware paths differ between dev and production.

For risky changes, explicitly mention:
- what could regress
- which flows were not validated
- which additional tests should be added

---

## Change sizing rules

Prefer:
- small diffs
- isolated edits
- incremental progress
- reviewable changes

Avoid:
- mixing refactor + feature + bug fix in one pass
- changing unrelated files
- renaming broadly without strong reason
- hidden behavior changes

If a task would benefit from multiple steps, propose a phased approach:
- phase 1: safe minimal implementation
- phase 2: cleanup or optimization
- phase 3: further improvements if needed

---

## Output format

For non-trivial tasks, return results in this structure:

1. Plan
2. Delegation
3. Findings
4. Changes made
5. Validation
6. Risks / follow-ups

Keep the response concise but complete.

---

## Definition of done

A task is not done until:
- the relevant code path has been inspected
- the requested change has been implemented or the blocker is clearly explained
- validation has been performed or its absence is clearly stated
- Docker build has passed and health endpoint returns `"status":"ok"` (only when Docker build is indicated by the "When to run a full Docker build" criteria above)
- risks and assumptions are made explicit
- the final diff has been reviewed for correctness and regressions

---

## Default behavior

If no special instruction is given:
- inspect before editing
- choose minimal safe changes
- preserve conventions
- validate touched behavior
- review before finalizing