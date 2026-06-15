# Production Monitoring & Observability — GetirBakim V2

**Last updated:** 2026-05-27

---

## Monitoring Stack Overview

```
                    ┌─────────────┐
                    │  UptimeRobot │  External uptime + SSL expiry monitoring
                    └──────┬──────┘
                           │
┌──────────┐       ┌───────┴───────┐
│  Sentry  │       │   Cloudflare  │  WAF events + traffic analytics
│  (errors)│       │   Analytics   │
└────┬─────┘       └───────────────┘
     │                    │
     │            ┌───────┴───────┐
     │            │  Contabo VPS  │
     │            │               │
     │            │  ┌─────────┐  │
     └────────────┤  │ Next.js │  │  App logs + health endpoint
                  │  │ (Docker)│  │
                  │  └─────────┘  │
                  │               │
                  │  ┌─────────┐  │
                  │  │ Nginx   │  │  Access logs + error logs
                  │  │ (Docker)│  │
                  │  └─────────┘  │
                  └───────────────┘
```

---

## 1. UptimeRobot — External Monitoring

### Setup

1. Go to https://uptimerobot.com
2. Sign up (free tier: 50 monitors, 5-minute intervals)
3. Create monitors:

### Monitors to Create

| # | Monitor Type | URL / Target | Interval | Alert When |
|---|-------------|-------------|----------|------------|
| 1 | HTTP(s) | `https://getirbakim.com/api/health` | 5 min | Down, or response != 200 |
| 2 | HTTP(s) | `https://getirbakim.com/tr` | 5 min | Down, or response != 200 |
| 3 | HTTP(s) | `https://getirbakim.com/en` | 5 min | Down, or response != 200 |
| 4 | Keyword | `https://getirbakim.com/api/health` | 5 min | Keyword `"status":"ok"` NOT found |
| 5 | SSL | `getirbakim.com` | 24 hours | Expires in < 14 days |
| 6 | Ping | `<VPS_IP>` | 5 min | Down |

### Alert Contacts

Set up notifications via:
- Email (default)
- Slack webhook (recommended for team alerts)
- Discord webhook (optional)
- SMS (premium)

### Status Page (Optional)

UptimeRobot Public Status Page:
- Create at UptimeRobot → Status Pages
- Share URL: `https://status.getirbakim.com` (requires CNAME DNS record)
- Shows stakeholders live status without giving them UptimeRobot access

---

## 2. Sentry — Error Tracking

### Why Sentry for GetirBakim

- **Production errors**: Unhandled exceptions in API routes, SSR failures
- **Search failures**: Meilisearch errors, empty results, query parsing issues
- **Payment errors**: Tami payment callback failures, amount mismatches
- **Supplier sync errors**: Dinamik/SETA API failures, data shape changes
- **Auth issues**: Login failures, middleware errors

### Next.js + Sentry Setup

1. Install Sentry SDK:
```bash
bun add @sentry/nextjs
```

2. Create `sentry.client.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,  // 10% of transactions (adjust for cost)
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

3. Create `sentry.server.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

4. Create `sentry.edge.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

5. Environment variables:
```
# .env.production
NEXT_PUBLIC_SENTRY_DSN=https://xxxxxx@yyyyy.ingest.sentry.io/zzzzzz
SENTRY_DSN=https://xxxxxx@yyyyy.ingest.sentry.io/zzzzzz
SENTRY_ORG=your-org
SENTRY_PROJECT=getirbakim
SENTRY_AUTH_TOKEN=sntrys_xxxxxx
```

6. Add `SENTRY_AUTH_TOKEN` as build arg in Dockerfile:
```dockerfile
ARG SENTRY_AUTH_TOKEN
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
```

### Critical Alerts to Configure in Sentry

| Alert | Condition | Action |
|-------|-----------|--------|
| Search API errors | Errors in `/api/search` | Check Meilisearch connectivity |
| Payment failures | Errors in `/api/payments/*` | Check Tami API, callback handling |
| Supplier sync failures | Errors in `/api/internal/suppliers/*` | Check Dinamik/SETA API |
| Auth failures | Spike in auth errors (rate limit) | Check NextAuth / application auth |
| High error rate | > 50 errors/min | Incident response |
| Server errors | 500-level errors | Check logs |

---

## 3. Health Endpoints

### Existing Health Endpoint

`GET /api/health` already returns:
```json
{
  "status": "ok",
  "version": "v0.2.3",
  "checks": {
    "database": "ok",
    "redis": "ok"  // or "unavailable"
  }
}
```

### Enhancements to Consider

Add to `/api/health`:
```typescript
// Additional checks
checks: {
  database: "ok" | "error",
  redis: "ok" | "unavailable",
  meilisearch: "ok" | "unavailable" | "error",
  uptime: process.uptime(),
  memory: process.memoryUsage(),
}
```

### Health Check Schedule

- **Docker healthcheck**: Every 30s (container-level)
- **UptimeRobot**: Every 5 min (external)
- **Cloudflare**: Continuous (edge-level)

---

## 4. Docker Log Monitoring

### View Logs

```bash
# All services, last 100 lines
docker compose logs --tail=100

# Specific service
docker compose logs app --tail=100
docker compose logs nginx --tail=100 -f  # follow mode
docker compose logs meilisearch --tail=100

# Filter by time
docker compose logs app --since 10m
docker compose logs app --since 2026-05-27T10:00:00
```

### Log Rotation

Already configured in `docker-compose.yml`:
```yaml
logging:
  driver: json-file
  options:
    max-size: "100m"
    max-file: "3"
```

This keeps the last 3 log files, each up to 100MB (app) or 50MB (nginx/meilisearch). Total max log storage: ~600MB.

### Log Locations on VPS

| Service | Docker Command | Volume Mount |
|---------|---------------|-------------|
| app | `docker compose logs app` | Docker internal |
| nginx | `docker compose logs nginx` | `nginx_logs` volume |
| meilisearch | `docker compose logs meilisearch` | Docker internal |
| host auth | `/var/log/auth.log` | N/A |
| host syslog | `/var/log/syslog` | N/A |

### Critical Log Patterns to Watch

```bash
# App errors
docker compose logs app | grep -i "error\|fatal\|unhandled"

# Nginx 5xx errors
docker compose logs nginx | grep " 50[0-9] "

# Meilisearch errors
docker compose logs meilisearch | grep -i "error\|panic"

# Rate limiting hits
docker compose logs nginx | grep "429"

# Slow queries (from query-monitor)
docker compose logs app | grep "slow_query"
```

---

## 5. Docker Health Checks

### Check Container Health

```bash
# All containers
docker compose ps

# Health status only
docker inspect --format='{{.Name}} {{.State.Health.Status}}' $(docker compose ps -q)

# Detailed health log
docker inspect --format='{{json .State.Health}}' getirbakim-app | jq
```

### Health Check Endpoints per Service

| Service | Internal URL | External URL |
|---------|-------------|-------------|
| app | `http://app:3000/api/health` (Docker network) | `https://getirbakim.com/api/health` |
| nginx | `nginx -t` (config test) | N/A |
| meilisearch | `http://meilisearch:7700/health` (Docker network) | N/A |

---

## 6. Performance Monitoring

### Current: Query Monitor

The existing `lib/query-monitor.ts` tracks:
- Total queries, slow queries, average duration
- Per-operation stats
- Slow query log (threshold configurable via `SLOW_QUERY_THRESHOLD`)

### Expose as API Endpoint (Recommended)

Add an internal endpoint to expose query stats:

```typescript
// app/api/internal/diagnostics/route.ts
import { getQueryStats, getSlowQueries } from '@/lib/query-monitor'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  // Protected by CRON_SECRET (same as other internal endpoints)
  const secret = request.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  return NextResponse.json({
    queryStats: getQueryStats(),
    slowQueries: getSlowQueries().slice(0, 20),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  })
}
```

### Critical Performance Metrics

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| P95 response time | Cloudflare Analytics | > 2s |
| P95 API response time | Cloudflare Analytics | > 1s |
| Search response time | Server-Timing header | > 500ms |
| DB query time | query-monitor | > 2000ms |
| Error rate | Cloudflare / Sentry | > 1% of requests |
| Cache hit rate | Server-Timing header | < 60% |
| Meilisearch index size | Meilisearch stats API | > 10GB |
| Memory usage | Docker stats | > 80% of limit |
| Disk usage | Host `df -h` | > 80% |

---

## 7. Automated Smoke Testing

### Existing Tools

- `scripts/vps-smoke.sh` — Basic health check
- `scripts/live-smoke.ts` — Comprehensive SEO + timing test from sitemap
- `scripts/audit-production-performance.sh` — Performance benchmark

### Schedule Smoke Tests (Cron on VPS)

```bash
# /etc/cron.d/getirbakim-smoke

# Quick smoke every 15 minutes
*/15 * * * * root cd /opt/getirbakim && bash scripts/vps-smoke.sh >> /var/log/getirbakim/smoke.log 2>&1

# Full smoke test daily at 2 AM
0 2 * * * root cd /opt/getirbakim && bun run scripts/live-smoke.ts --base https://getirbakim.com --concurrency 3 --rounds 2 --max-urls 50 >> /var/log/getirbakim/live-smoke.log 2>&1

# Performance audit weekly Monday at 4 AM
0 4 * * 1 root cd /opt/getirbakim && bash scripts/audit-production-performance.sh >> /var/log/getirbakim/perf-audit.log 2>&1
```

---

## 8. Disk & Resource Monitoring

### VPS Resource Check Script

Save as `/opt/check-resources.sh`:

```bash
#!/bin/bash
# Quick VPS resource check for GetirBakim

THRESHOLD_DISK=80
THRESHOLD_MEM=90

echo "=== Resource Check $(date) ==="

echo ""
echo ">>> Disk Usage:"
df -h / | awk 'NR==2{print "  Root: " $3 "/" $2 " (" $5 ")"}'
df -h /opt | awk 'NR==2{print "  /opt: " $3 "/" $2 " (" $5 ")"}'

echo ""
echo ">>> Memory:"
free -h | grep Mem | awk '{print "  Used: " $3 " / Total: " $2}'

echo ""
echo ">>> Docker Status:"
docker compose ps

echo ""
echo ">>> Docker Disk Usage:"
docker system df

echo ""
echo ">>> Recent Errors (last 1 hour):"
docker compose logs app --since 1h 2>&1 | grep -i "error\|fatal" | tail -5

echo ""
echo "=== Check Complete ==="
```

### Disk Alert (Cron)

```bash
# /etc/cron.d/getirbakim-disk-alert
# Alert if disk exceeds threshold
0 * * * * root [ $(df / | awk 'NR==2{print $5}' | tr -d '%') -gt 80 ] && echo "Disk warning on $(hostname)" | mail -s "Disk Alert" admin@getirbakim.com
```

---

## 9. Alert Runbook

### Severity Levels

| Level | Description | Response Time | Notification |
|-------|-------------|--------------|-------------|
| P1 - Critical | Site down, payments failing | 15 min | Phone + Slack + Email |
| P2 - High | Search broken, category pages down | 30 min | Slack + Email |
| P3 - Medium | Slow performance, Meilisearch unavailable | 2 hours | Email |
| P4 - Low | Non-critical error spike | 24 hours | Email digest |

### Common Issues and Responses

#### P1: Site Down

1. Check host accessible: `ping <VPS_IP>`
2. Check Docker: `docker compose ps`
3. Check nginx: `docker compose logs nginx --tail=50`
4. Restart: `docker compose restart`
5. If still down: `docker compose down && docker compose up -d`
6. Check disk full: `df -h`
7. Check Cloudflare status: https://www.cloudflarestatus.com/

#### P2: Search Broken

1. Check Meilisearch: `docker compose ps meilisearch`
2. Check Meilisearch health: `docker compose exec meilisearch wget -qO- http://localhost:7700/health`
3. Check index size: `curl -H "Authorization: Bearer $MEILI_MASTER_KEY" http://localhost:7700/indexes/products/stats`
4. Reindex if needed: `bun run scripts/meili-reindex.ts`

#### P2: High Error Rate

1. Check Sentry for error grouping
2. Check nginx logs for 5xx: `docker compose logs nginx | grep " 50[0-9] "`
3. Check app logs: `docker compose logs app --since 10m | grep -i error`
4. Check PostgreSQL: `docker compose exec postgres pg_isready`

---

## 10. Dashboard (Optional — Grafana + Prometheus)

For advanced monitoring, consider:

- **Prometheus** to scrape `/api/health` metrics
- **Grafana** dashboard for visual monitoring
- **cAdvisor** for container-level metrics (CPU, memory, network)

Setup is complex — only add when team size or traffic warrants it. For now, Cloudflare Analytics + Sentry + UptimeRobot covers key observability needs.

---

## 11. Immediate Actions (Priority Order)

1. **Set up UptimeRobot** (15 min) — critical for uptime monitoring
2. **Set up Sentry** (30 min + build) — critical for error visibility
3. **Schedule cron jobs** (10 min) — automate smoke tests
4. **Configure Cloudflare Analytics alerts** (5 min) — traffic anomalies
5. **Review logs weekly** — manual for now, automate later

---

## 12. Validation

```bash
# Verify health endpoint
curl -s https://getirbakim.com/api/health | jq .

# Verify Docker health
docker inspect --format='{{.State.Health.Status}}' getirbakim-app

# Verify log rotation
docker inspect --format='{{json .HostConfig.LogConfig}}' getirbakim-app | jq .

# Manual smoke test
bash scripts/vps-smoke.sh
```
