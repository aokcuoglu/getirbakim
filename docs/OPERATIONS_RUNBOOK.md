# Operations Runbook

## Healthcheck

### Application Health
```bash
curl -s http://localhost:3000/api/health | jq
```

Expected response:
```json
{
  "status": "ok",
  "version": "v0.1.3",
  "checks": { "database": "ok" },
  "runtimeMs": 5,
  "timestamp": "2026-05-05T12:00:00.000Z"
}
```

### Public Health (through nginx)
```bash
curl -s https://getirbakim.com/api/health | jq
curl -s https://www.getirbakim.com/api/health | jq
```

### Docker Container Health
```bash
docker inspect --format='{{.State.Health.Status}}' getirbakim-app
docker inspect --format='{{.State.Status}}' getirbakim-app
```

## Docker Logs

### App Logs
```bash
docker compose logs app --tail=100 -f
docker compose logs app --since 1h
docker compose logs app --since 24h | grep -i error
```

### Container Status
```bash
docker compose ps
docker compose top
```

### Restart Container
```bash
docker compose restart app
```

### Full Rebuild
```bash
docker compose --env-file .env.production down --remove-orphans
docker compose --env-file .env.production up -d --build
```

## Nginx Logs

### Access Logs
```bash
sudo tail -100 /var/log/nginx/getirbakim.com.access.log
sudo tail -100 /var/log/nginx/getirbakim.com.access.log -f
```

### Error Logs
```bash
sudo tail -100 /var/log/nginx/getirbakim.com.error.log
sudo tail -50 /var/log/nginx/error.log
```

### Test nginx Config
```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

## Disk / Memory Checks

### Disk Usage
```bash
df -h
du -sh /opt/getirbakim-v2
docker system df
```

### Memory Usage
```bash
free -h
docker stats --no-stream
```

### Docker Cleanup
```bash
docker image prune -f
docker builder prune -f
```

Do NOT run `docker volume prune` — database is external but Redis/data volumes should be preserved.

## Deploy Commands

### GitHub Actions Deploy (recommended)

Go to **GitHub → Actions → Deploy VPS → Run workflow** to trigger a controlled deploy.

See [docs/GITHUB_ACTIONS_DEPLOY.md](GITHUB_ACTIONS_DEPLOY.md) for setup and details.

### Standard Deploy via Script
```bash
cd /opt/getirbakim-v2
bash scripts/vps-deploy.sh
```

With explicit options:
```bash
PROJECT_PATH=/opt/getirbakim-v2 BRANCH=main DOMAIN=https://getirbakim.com bash scripts/vps-deploy.sh
```

### Manual Deploy
```bash
cd /opt/getirbakim-v2
git pull origin main
docker compose --env-file .env.production down --remove-orphans
docker compose --env-file .env.production up -d --build
sleep 5
docker compose --env-file .env.production ps
curl -sf http://127.0.0.1:3000/api/health
curl -sf https://getirbakim.com/api/health
```

## Rollback Commands

### Automatic Rollback via Script
```bash
cd /opt/getirbakim-v2
bash scripts/vps-rollback.sh v0.1.2
```

Or with environment variable:
```bash
ROLLBACK_REF=v0.1.2 bash scripts/vps-rollback.sh
```

### Manual Rollback
```bash
cd /opt/getirbakim-v2
git tag -l
git checkout v0.1.2
docker compose --env-file .env.production down --remove-orphans
docker compose --env-file .env.production up -d --build
sleep 5
curl -sf http://127.0.0.1:3000/api/health
git checkout main
```

Note: After rollback, the repo will be in detached HEAD state. Run `git checkout main` when ready to resume tracking main.

## Common Failures

### DB Auth Failed
- **Symptom**: `/api/health` returns `checks.database: "error"` or Prisma P1000
- **Check**: `DATABASE_URL` in `.env.production` is correct
- **Check**: Supabase project is not paused
- **Check**: IP allowlist if using Supabase direct connection
- **Fix**: Update `DATABASE_URL`, restart container

### EMAXCONNSESSION / Supabase Pool Exhaustion
- **Symptom**: Browser shows "Something went wrong". Logs show `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`
- **Check**: `DATABASE_POOL_MAX` in `.env.production` is not too high (recommended: 4)
- **Check**: Is local Docker also connected to the same Supabase project? Combined pools must stay under 15.
- **Check**: Multiple dev instances running simultaneously?
- **Fix**: Set `DATABASE_POOL_MAX=4` on VPS, `DATABASE_POOL_MAX=2` locally. Stop unused local containers.
- **Do NOT**: Switch to transaction pooler port 6543 — PrismaPg requires prepared statements.

### Env Var Missing
- **Symptom**: App fails to start, container exits immediately
- **Check**: `docker compose logs app --tail=50`
- **Fix**: Add missing variable to `.env.production`, restart container

### Docker Port Conflict
- **Symptom**: Container fails to start, "port is already allocated"
- **Check**: `docker compose ps`, `ss -tlnp | grep 3000`
- **Fix**: Stop conflicting service or change app port in `docker-compose.yml`

### Nginx 502 Bad Gateway
- **Symptom**: nginx returns 502 to browser
- **Check**: App container is running (`docker compose ps`)
- **Check**: App responds at `http://127.0.0.1:3000/api/health`
- **Check**: nginx upstream matches `server 127.0.0.1:3000;`
- **Fix**: Restart app container; if it won't start, check app logs

### SSL Renewal Issue
- **Symptom**: Browser shows certificate error
- **Check**: `sudo certbot certificates`
- **Check**: `sudo certbot renew --dry-run`
- **Fix**: `sudo certbot renew --nginx -d getirbakim.com -d www.getirbakim.com`
- **Fix**: Ensure port 80 is open for ACME challenge

### Container OOM (Out of Memory)
- **Symptom**: Container killed, exit code 137
- **Check**: `dmesg | grep -i oom`
- **Check**: `free -h`
- **Fix**: Add swap, increase VPS memory, or optimize Node.js memory with `NODE_OPTIONS=--max-old-space-size=512`

### Build Failure
- **Symptom**: `docker compose build` fails
- **Check**: `docker compose logs app --tail=50`
- **Fix**: Ensure all dependencies resolve; check for TypeScript errors; try `--no-cache`

### GitHub Actions Deploy Failure
- **Symptom**: Workflow run shows red X in GitHub Actions
- **Check**: Expand the failed step in the workflow run
- **Common causes and fixes**:
  - **SSH auth fails**: Verify `VPS_SSH_KEY` secret matches the private key; verify public key is in VPS `~/.ssh/authorized_keys`
  - **known_hosts fails**: Verify `VPS_HOST` secret is correct IP; `ssh-keyscan` must reach the VPS on port 22
  - **.env.production missing**: Deploy script aborts; SSH in and verify `.env.production` exists in project directory
  - **git pull fails**: Check VPS has network access to GitHub; verify deploy key (read-only) is configured for the repo
  - **docker build fails**: Check VPS disk space (`df -h`); check Docker daemon is running; try `docker compose build --no-cache`
  - **smoke test fails**: Check container status, logs, nginx config; see smoke test output in workflow
  - **nginx still serving old app**: `sudo systemctl reload nginx`; verify nginx upstream points to `127.0.0.1:3000`

### Smoke Tests

### Quick Smoke
```bash
curl -sf http://127.0.0.1:3000/api/health
curl -sf https://getirbakim.com/api/health
curl -sI https://getirbakim.com/tr | head -1
curl -sI https://getirbakim.com/en | head -1
```

### Full VPS Smoke (internal only)
```bash
bash scripts/vps-smoke.sh
```

### Full VPS Smoke (with public domain)
```bash
DOMAIN=getirbakim.com bash scripts/vps-smoke.sh
# or
bash scripts/vps-smoke.sh getirbakim.com
```