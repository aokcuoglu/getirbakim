# Contributing / Git Workflow

This repo uses a lightweight **`dev` → PR → `main` → auto-deploy** flow.
`main` is always deployable and every push to it deploys production
(getirbakim.com). Do your work on a branch, open a PR into `main`, let CI pass,
merge, and the deploy runs itself.

## Branches

- **`main`** — production. Protected by convention (repo is private/free tier, so
  server-side branch protection is not enforced). Never commit directly; land
  changes via PR.
- **`dev`** — shared integration branch. Kept in sync with `main` between PRs.
- **`feat/*` / `fix/*`** — optional short-lived topic branches for larger work.

## Day-to-day flow

```bash
# 1. Start from an up-to-date main
git checkout main && git pull --ff-only

# 2. Work on dev (or a feat/* branch cut from main)
git checkout dev && git merge --ff-only main   # keep dev at main
#   ...make changes, commit...
git add -p && git commit -m "feat: ..."

# 3. Push and open a PR into main
git push origin dev
gh pr create --base main --head dev --fill

# 4. CI (.github/workflows/ci.yml) runs lint + typecheck + tests on the PR.
#    Wait for it to go green:
gh pr checks --watch

# 5. Merge (squash keeps main history clean)
gh pr merge --squash --delete-branch=false

# 6. The push to main automatically triggers Deploy VPS → getirbakim.com.
gh run watch $(gh run list --workflow "Deploy VPS" --limit 1 --json databaseId --jq '.[0].databaseId')

# 7. Bring your local main + dev back in sync
git checkout main && git pull --ff-only
git checkout dev  && git merge --ff-only main && git push origin dev
```

## CI checks (`.github/workflows/ci.yml`)

Runs on every PR into `main` and every push to `dev`:

- `bun install --frozen-lockfile` (runs `prisma generate` via postinstall; CI sets
  a dummy `DATABASE_URL` so generate resolves — it never connects)
- **`bun run check:unsafe-sql`** — banned raw-SQL check (**blocking**)
- **`bun run typecheck`** (`tsc --noEmit`) — **advisory / non-blocking** for now.
  `next build` ships with `typescript.ignoreBuildErrors: true` and the repo has
  many pre-existing tsc errors (stale admin code vs. schema), so typecheck is
  surfaced as an annotation but does not block merges. Once those are cleaned up,
  flip `continue-on-error: false` in `ci.yml` to make it blocking.
- **`bun test`** — 225 tests, no DB/network needed (**blocking**)

Keep the blocking checks green before merging.

## Deploy (`.github/workflows/deploy-vps.yml`)

Triggers:

- **Push to `main`** — automatic production deploy (version = short commit SHA).
- **Push a `v*` tag** — versioned release deploy (version = tag name, e.g. `v0.22.0`).
- **Manual `workflow_dispatch`** — deploy on demand, optional `version` input.

The job SSHes to the VPS, runs `git reset --hard origin/main`, then
`scripts/vps-deploy.sh`, and finishes with `scripts/vps-smoke.sh`. Deploys are
serialized (`concurrency: deploy-vps`) so they never overlap.

### Cutting a versioned release

When you want a named version instead of a SHA:

```bash
git checkout main && git pull --ff-only
git tag v0.22.0
git push origin v0.22.0   # triggers Deploy VPS with NEXT_PUBLIC_BUILD_VERSION=v0.22.0
```
