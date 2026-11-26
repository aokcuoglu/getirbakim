---
name: deliver
description: Orchestrate one getirbakim development end to end — issue → worktree from origin/dev → plan → implement → code + UI review → QA → PR into dev → CI → merge into dev → update the main checkout → clean up. Use for "/deliver 489", "/deliver <description>" (not the built-in /ship, which shadows a project skill of that name), or whenever the user asks to start, build, fix or deliver a development in getirbakim.
argument-hint: <issue number | short description>
---

You are the **orchestrator** of one getirbakim development. You coordinate the `getirbakim-*` agents; you do not write product code yourself (small glue work is fine). Rules are in `AGENTS.md` and the agent files; do not re-read `docs/development-workflow.md` or `docs/harness/README.md` unless a step below is unclear. Give the user a one-line Turkish update at every stage change.

Argument: `$ARGUMENTS` — Issue number or description (then first open an Issue under `/issue` rules).

## 0. Preconditions
- Main checkout `/Users/void/www/getirbakim` (branch `dev`); do not touch other sessions' uncommitted work. `git fetch origin`.
- `gh issue view <N>`; derive `<type>` (feat|fix|perf|refactor|docs|chore|ci|test), `<area>`, `<slug>` (kebab, ≤5 words).
- `git worktree list` + `gh pr list`: if a branch/worktree/PR already exists for the Issue, use it; do not open a new one.

## 1. Worktree
```
git worktree add ../getirbakim-<N> -b <type>/<N>-<slug> origin/dev
ln -s /Users/void/www/getirbakim/.env.local ../getirbakim-<N>/.env.local
ln -s /Users/void/www/getirbakim/node_modules ../getirbakim-<N>/node_modules   # enough for lint/tsc/test; browser QA does a real npm ci
```
Inside Herdr (`HERDR_ENV=1`) do the same with `herdr worktree create --branch <type>/<N>-<slug> --base origin/dev --path ../getirbakim-<N>` (for the sidebar tree). `WT=/Users/void/www/getirbakim-<N>`; give this path to every agent. If `package.json` dependencies change, run `npm ci` in the worktree instead of the symlink.

## 2. Plan
Call `getirbakim-planner` with the Issue no + `WT` (skip for a small one-file fix). The plan is the developer's brief and the QA route list. If the plan says "too big", open the follow-up Issues now and continue with the first slice.

## 3. Implement
Call `getirbakim-developer` with `WT`, the Issue no and the full plan. It runs on sonnet; Opus is an escalation, not a default (an Opus developer run costs ~10× a sonnet one). Pass `model: "opus"` only when (a) the plan alters or drops existing tables/columns or migrates existing data in `db/*.sql` (new functions, indexes or query rewrites do not count), (b) the change touches money or identity flows — payment/TAMI, order totals/refunds, auth/session/password code, or (c) the same sonnet developer failed the same check or review finding twice. Performance/query tuning, UI, SEO/copy, importer/sync tweaks and single-module refactors stay on sonnet. When you pass opus, start the Agent `description` with `opus:` and the one-line reason. Read **Checks** (and their SHA) and **Not done** in the report; pass Checks and SHA verbatim to the reviewers and QA in their brief; send a failed check back to the same agent via SendMessage (do not open a new agent).

## 4. Review
For a small UI-only change (≤2 `.tsx`/`.css` files; no `db/`, `src/modules/`, `src/lib/`, `actions.ts`, `route.ts`, auth/payment/sync touch) call only `getirbakim-ui-ux` (`WT` + QA routes). Otherwise, in parallel in one message:
- `getirbakim-reviewer` (`WT`).
- `getirbakim-ui-ux` (`WT` + QA routes) — only if `.tsx`/`.css` changed.
Send 🔴 and 🟡 findings to the developer → in the fix round ask the same reviewer via SendMessage about the fixed items only; do not open a new agent. At most two fix rounds; then report the rest to the user.

## 5. QA
If a route/component changed, call `getirbakim-qa` with `WT`, the planned routes/roles and the Issue's acceptance criteria; give the checks' SHA so QA focuses on the browser walk. Only one browser QA at a time (single Chrome). ❌ → one round with the developer, then the user.

## 6. PR
CI is the final deterministic gate. For small fix commits after QA, locally `admin-ui-lint --changed` (and `tsc` if needed) is enough; CI catches the rest.

In `WT`:
- `git status` clean; commits conventional; `git fetch origin && git rebase origin/dev` (the developer resolves conflicts); `git push -u origin <branch>`.
- `gh pr create --base dev --title "<type>(<area>): <summary>" --body-file -` — body: Summary (problem, resulting behaviour), Verification (review/QA verdicts, tests run), Operations (command needed in prod or "none"), `Closes #<N>`; finish with the attribution line from the system reminder. Labels same as the Issue: type label + `area:*` + `release:minor|patch` for behaviour changes (`--label`).
- Wait for CI. CI gate (never skip): run `gh pr checks <PR> --watch --fail-fast` **unpiped** (a chain like `| tail` swallows the exit code, #528). Right before merge verify every check separately:
  ```
  gh pr view <PR> --json statusCheckRollup -q '[.statusCheckRollup[] | .conclusion] | all(. == "SUCCESS")'
  ```
  If the output is not `true`, NO merge. If the failure is unrelated to this PR and looks flaky: `gh run rerun <run> --failed`, wait again, verify again; open an Issue for the unrelated flaky test (`Found in #<PR>`) and note it on the PR.
- If red and caused by this PR, give the log (`gh run view --log-failed`) to the developer, fix, push, wait again.

## 7. Merge and cleanup (without asking — the policy covers it)
1. CI gate above is `true` + `gh pr view <PR> --json mergeable,baseRefName` (base must be `dev`) → `gh pr merge <PR> --merge --delete-branch` (the guard allows base=dev; any other base asks for approval — then STOP).
2. Update the main checkout: `cd /Users/void/www/getirbakim && git merge --ff-only origin/dev` (after `git fetch`). If another session's uncommitted file blocks the ff and the file is identical to origin/dev (`cmp`): stash → ff → stash drop; if different, do not touch it, tell the user. Do not kill the dev server on 3000; if new dependencies arrived, `npm install` + `touch next.config.ts`.
3. Remove only this work's worktree: `git worktree remove ../getirbakim-<N>` (if clean; symlinks do not block) + `git worktree prune`; local branch `git branch -D <branch>`; `git fetch --prune`.
4. Report (Turkish): Issue and PR links, one-paragraph summary, review/QA verdicts, CI result, merge commit, operations step, out-of-scope items (with follow-up Issues opened). If a lot has piled up on dev, suggest `/release-check` — but main only with the user's approval.

## Rules
- No commits on `dev`/`main`; push to main, dev→main merge, version tags, `release-aws` — only in the `/release-check` flow with the user's explicit approval.
- Do not widen scope. Other work you discover becomes a new Issue (first `gh issue list --search`), body `Found in #N`.
- Protect other worktrees, branches, uncommitted work in the main checkout and the dev server on 3000.
