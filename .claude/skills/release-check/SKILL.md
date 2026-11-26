---
name: release-check
description: Show what is on dev but not yet on main in getirbakim, propose the next SemVer version and release scope, and — only after the user's explicit approval — prepare the versioned dev → main release (manifest + CHANGELOG PR into dev, dev → main PR, merge, annotated tag, GitHub Release). Never triggers the AWS production deploy without a separate approval. Use for "/release-check", "sürüm çıkaralım mı?", or when the session brief suggests a release.
---

Policy: `docs/development-workflow.md` → "`main` sürümleri ve Git tag'leri" and "Deploy ve staging kararı". Talk to the user in Turkish.

## 1. State (read-only)
- `git fetch origin --tags`; last release `git describe --tags --abbrev=0 origin/main`; `package.json` version.
- Scope: `git log --first-parent --format='%h %s' origin/main..origin/dev` and merged PRs (`gh pr list --state merged --base dev --search "merged:>=<last release date>" --json number,title,labels`).
- Impact: any `feat` / `release:minor` → MINOR; only `fix`/`perf` → PATCH; MAJOR only if the user asks. Docs/CI alone do not need a release.
- Vehicle oil data: `git diff --quiet <last-tag> origin/dev -- data/vehicle_type_oil_specs.csv scripts/import-vehicle-oils.ts` (exit 1 = changed). `release-aws` / `db:setup` do not import this CSV; if changed, tell the user and add it to the "Deploy and operations" part of the CHANGELOG release section and the release PR body (with the command in step 4).
- Read the top section of `CHANGELOG.md` (keep its format).

## 2. Proposal and APPROVAL
Show the user: current version → proposed `vX.Y.Z`, PR list (with type and area), work not included/not ready (open operations step, half-done feature), a short English title. **Ask for explicit approval** (AskUserQuestion). Without approval stop here. Approval for one release does not cover the next.

## 3. Preparation (after approval)
1. A `chore(release): prepare vX.Y.Z` Issue under `/issue` rules; worktree `../getirbakim-<N>` branch `chore/<N>-release-vX.Y.Z` (from origin/dev).
2. `npm version X.Y.Z --no-git-tag-version` (package.json + lock together); a release section in `CHANGELOG.md`: features, fixes, Issue/PR links, migration/operations steps.
3. PR → `dev`, CI green, merge (normal `/deliver` steps 6–7).
4. `gh pr create --base main --head dev --title "chore(release): vX.Y.Z" --label release:<…>` — scope and verification in the body. Wait for and verify CI with the `/deliver` step 6 gate (unpiped `gh pr checks --watch`, then `statusCheckRollup` all `SUCCESS`); only then `gh pr merge <PR> --merge` (the guard asks for confirmation — the user already approved; show version and scope again).
5. Annotated tag on the main merge commit: `git tag -a vX.Y.Z <merge-sha> -m "vX.Y.Z — <title>"` + `git push origin vX.Y.Z`; `gh release create vX.Y.Z --title "vX.Y.Z — <title>" --notes-file <CHANGELOG section>`. Never move/delete an existing tag.
6. Align dev to main: `git push origin origin/main:refs/heads/dev` (fast-forward; not force) and in the main checkout `git merge --ff-only origin/dev`.
7. Report: merge, version, tag, Release link.

## 4. Production release — SEPARATE step
Merging to `main` does not deploy. Release only if the user separately and explicitly asks: `gh workflow run release-aws.yml --ref main -f version=X.Y.Z` (X.Y.Z = `package.json` version on `main`; the guard job stops a wrong branch, trigger user or version before AWS), watch with `gh run watch`, report the result and smoke tests (`https://getirbakim.com` home, search, `/api/health/suppliers`). Do not change deploy workflows; do not enable Contabo workflows.

### Vehicle oil data is imported to AWS separately
If `data/vehicle_type_oil_specs.csv` (or `scripts/import-vehicle-oils.ts`) changed in the release, remind the user after `release-aws` finishes: the operations image (`COPY . .`) carries the CSV but the import does not run automatically. Idempotent task (writes to the DB; only with user approval), in the `ecs run-task` form of `scripts/sync-storefront-production.ts`, with the operations task definition and network settings taken from the App/Network stack outputs:

```
aws ecs run-task --cluster <App.ClusterName> --task-definition <App.OperationsTaskFamily> --launch-type FARGATE --count 1 \
  --network-configuration '{"awsvpcConfiguration":{"subnets":[<Network.PrivateSubnetIds>],"securityGroups":["<Network.OperationsSecurityGroupId>"],"assignPublicIp":"DISABLED"}}' \
  --overrides '{"containerOverrides":[{"name":"<App.OperationsContainerName>","command":["node","--import","tsx","scripts/import-vehicle-oils.ts"]}]}'
```

(`npm run db:vehicle-oils` writes to the local `.env.local` DB; not for AWS.) There is no `production-task.sh` subcommand for this (that script is the old Contabo/compose path) and no automatic step in the release process: a built-in AWS run path remains open work (#565).
