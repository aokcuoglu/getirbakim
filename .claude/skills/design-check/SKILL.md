---
name: design-check
description: Audit getirbakim UI against the /yonetim stock-shadcn rule (AGENTS.md) and the storefront language (DESIGN.md) — deterministic admin-ui-lint first, then a getirbakim-ui-ux review of the diff (screenshots if a server is given). Use for "/design-check", "/design-check <path>", or before opening a PR that touches .tsx/.css files.
argument-hint: [--changed | path…] [routes…]
---

Arguments: `$ARGUMENTS` (default `--changed`).

1. In the worktree (main checkout for a repo-wide audit) run `node scripts/harness/admin-ui-lint.mjs <arguments or --changed>`; paste findings verbatim. `error` lines block the PR (CI runs it too); judge `warning`s (corner/shadow) in context.
2. Call `getirbakim-ui-ux` with the worktree path, the files/paths in scope and the given routes. Ask for screenshots only if a worktree server is running (e.g. the 31NN port `/qa` opened); 3000 serves the main checkout, not the worktree.
3. Merge into one list: 🔴 → 🟡 → 🟢, with file:line and fix. For a repo-wide audit group by component/page and propose Issues via `/issue` instead of fixing in place. Report to the user in Turkish.
