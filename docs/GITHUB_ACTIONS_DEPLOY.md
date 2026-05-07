# GitHub Actions VPS Deployment

## Purpose (v0.1.5)

Controlled, SSH-based deployment automation that connects from GitHub Actions to the Contabo VPS, pulls the latest code, rebuilds Docker, restarts the app, and runs smoke tests — all without exposing secrets.

This workflow does **not** auto-deploy on every push to `main`. It is triggered only by:
- **Manual `workflow_dispatch`** — click "Run workflow" in GitHub Actions UI, optionally specifying a version string
- **Tag push** (`v*`) — automatically deploys on version tags, using the tag name as the deploy version

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Value | Notes |
|--------|-------|-------|
| `VPS_HOST` | `173.249.36.2` | Contabo VPS IP address |
| `VPS_USER` | `root` | Current; create dedicated deploy user as next hardening step |
| `VPS_SSH_KEY` | *(private key content)* | Private key for SSH deploy; see key setup below |
| `VPS_PROJECT_PATH` | `/opt/getirbakim-v2` | Absolute path on VPS |
| `VPS_DOMAIN` | `https://getirbakim.com` | Public domain for smoke tests |

## SSH Key Setup for GitHub Actions Deploy

### Generate a dedicated deploy key

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy@getirbakim" -f github-actions-deploy
```

This creates:
- `github-actions-deploy` — private key (store in GitHub Secret `VPS_SSH_KEY`)
- `github-actions-deploy.pub` — public key (install on VPS)

### Install the public key on VPS

```bash
cat github-actions-deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Store the private key in GitHub

1. Go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `VPS_SSH_KEY`
4. Value: paste the full content of `github-actions-deploy` (including `-----BEGIN` and `-----END` lines)
5. Delete the local private key file after storing

### Key hygiene

- Use a dedicated key for GitHub Actions deploy — do not reuse your personal SSH key
- Add a passphrase if possible (note: GitHub Actions cannot prompt for passphrase, so use a key without passphrase or use `ssh-agent`)
- Rotate the key if it is ever exposed
- Delete the private key from your local machine after adding it to GitHub

## Deploy Key vs SSH Key — Difference

| Concept | What it does | Where to store |
|---------|-------------|----------------|
| **GitHub Deploy Key** (read-only) | Allows VPS to `git pull` from your private repo | VPS `~/.ssh/authorized_keys`; public key added to GitHub repo Deploy Keys |
| **GitHub Actions SSH Key** | Allows GitHub Actions to SSH into VPS and run deploy commands | Private key in GitHub Secret `VPS_SSH_KEY`; public key in VPS `~/.ssh/authorized_keys` |

These are **two separate keys** with different purposes. Do not confuse them.

## Why .env.production Stays Only on VPS

- `.env.production` contains production secrets (Supabase service role key, Tami keys, database URLs, etc.)
- It is gitignored and never committed to the repository
- The GitHub Actions workflow never needs `.env.production` — it only runs `git pull` and `docker compose` on the VPS, where `.env.production` already exists
- This prevents secrets from being exposed in GitHub Actions logs, artifacts, or caches
- If `.env.production` is missing on VPS, the deploy script will abort before rebuilding

## How to Run Manual workflow_dispatch

1. Go to **Actions** tab in your GitHub repository
2. Select **"Deploy VPS"** workflow in the left sidebar
3. Click **"Run workflow"** button (top right)
4. Select the branch (usually `main`)
5. Optionally enter a **version** string (e.g. `v0.1.5`). If left empty, the short commit SHA is used.
6. Click **"Run workflow"** to confirm
7. Watch the workflow run in real-time

## Build Version Inference

The deploy version injected into the Docker build is determined in this priority order:

1. **Manual `workflow_dispatch` input** — if a `version` string is provided
2. **Tag name** — if triggered by a tag push (e.g. `v0.1.5`)
3. **Short commit SHA** — if no version or tag is available

This version is passed as `NEXT_PUBLIC_BUILD_VERSION` to the deploy script, which exports it for `docker compose build`. The `/api/health` endpoint reports this version.

**Important:** `.env.production` should NOT contain `NEXT_PUBLIC_BUILD_VERSION`. The deploy script injects it at build time.

## What the Workflow Does

1. Determines the deploy version (from input, tag, or commit SHA)
2. Configures SSH key from `VPS_SSH_KEY` secret
3. Adds VPS host to `known_hosts` via `ssh-keyscan`
4. SSHs into VPS and runs `scripts/vps-deploy.sh` with `NEXT_PUBLIC_BUILD_VERSION` set:
   - `cd` into project directory
   - `git pull origin main`
   - Resolve deploy version from `NEXT_PUBLIC_BUILD_VERSION`, `GITHUB_REF_NAME`, `VERSION`, git tag, or short SHA
   - Verify `.env.production` exists
   - `docker compose down --remove-orphans`
   - `NEXT_PUBLIC_BUILD_VERSION=<version> docker compose up -d --build`
   - Health check at `http://127.0.0.1:3000/api/health` (reports version)
   - Public smoke at `${VPS_DOMAIN}/api/health`, `/tr`, `/en`
5. Runs `scripts/vps-smoke.sh` for comprehensive checks
6. Cleans up SSH key from runner

The workflow **fails** if smoke tests fail.

## How to Read Logs

- Go to **Actions** tab → click the workflow run → expand each step
- SSH command output from VPS appears in the "Deploy via SSH" step
- Smoke test results appear in the "Run smoke tests" step
- Secrets are masked automatically by GitHub Actions; `.env.production` content is never printed by deploy scripts

## Rollback Instructions

If a deploy fails or introduces a problem:

### Via GitHub Actions (manual SSH)

```bash
ssh root@173.249.36.2
cd /opt/getirbakim-v2
bash scripts/vps-rollback.sh v0.1.3
```

### Via GitHub Actions workflow (future enhancement)

Currently there is no automated rollback workflow. Rollback is manual via SSH.

### Full manual rollback

```bash
ssh root@173.249.36.2
cd /opt/getirbakim-v2
git tag -l                              # list available tags
git checkout v0.1.3                     # checkout target version
docker compose --env-file .env.production down --remove-orphans
docker compose --env-file .env.production up -d --build
curl -sf http://127.0.0.1:3000/api/health
git checkout main                       # return to main when ready
```

## Root User Warning

The current deployment uses `root` as the SSH user. This is acceptable for initial controlled deployment where root access is already used for manual deploys.

**Recommendation:** Create a dedicated `deploy` user with limited privileges as the next hardening step:
- Only allow `docker compose` and `git` commands
- Use `sudoers` for specific command allowlisting
- Disable password authentication
- Restrict to the project directory

## Security Checklist

- [ ] `VPS_SSH_KEY` is a dedicated key (not your personal key)
- [ ] Private key is deleted from local machine after adding to GitHub
- [ ] `.env.production` is NOT stored in GitHub Secrets or repository
- [ ] `.env.production` does NOT contain `NEXT_PUBLIC_BUILD_VERSION` (deploy script injects it)
- [ ] Deploy script does not `cat` or print `.env.production`
- [ ] Deploy script exits on `.env.production` missing
- [ ] Workflow only triggers on `workflow_dispatch` or `v*` tags
- [ ] SSH key is cleaned up from GitHub Actions runner after run
- [ ] `scripts/secret-scan.sh` passes before release