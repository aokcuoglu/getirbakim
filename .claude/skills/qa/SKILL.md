---
name: qa
description: Run the getirbakim QA pass (admin-ui-lint, typecheck, lint, relevant tests, then a Chrome walk of the given routes on desktop and mobile on a short-lived worktree server) via the getirbakim-qa agent. Use for "/qa", "/qa <issue|worktree> <routes>", or when a change must be verified in the real app before review/merge.
argument-hint: [worktree path | issue no] [routes…]
---

Arguments: `$ARGUMENTS`

1. Find the worktree: explicit path, Issue number (`/Users/void/www/getirbakim-<N>` or the branch containing `/<N>-` in `git worktree list`), or the current directory (if its branch is not `dev`/`main`). If only the main checkout exists, stop and ask which worktree to test.
2. Build the route list: from the arguments; otherwise from the branch's changed files (`git diff --name-only origin/dev...HEAD` → `src/app/<path>/page.tsx` → `/<path>`, drop group folders like `(legal)`, find a real sample record for `[id]`). If the Issue number is known, add its acceptance criteria.
3. Call `getirbakim-qa` with the worktree path, routes, roles (/yonetim → admin, service pages → service, storefront → visitor) and acceptance criteria. Standalone, the checks still run; inside `/ship` they may be skipped by the SHA in the brief.
4. Relay the QA report to the user (table + verdict, summary in Turkish). Inside `/ship` with a ❌ verdict, send the blockers to the developer agent; otherwise leave it to the user.
