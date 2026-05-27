# Production Infrastructure Audit — Getirbakim V2

**Date:** 2026-05-27
**Auditor:** DevOps + Security + Platform Engineer
**Scope:** Full stack infrastructure assessment for production hardening

---

## 1. Current Architecture

```
                          INTERNET
                             │
                    ┌────────┴────────┐
                    │  Cloudflare DNS │  (proxy status: UNKNOWN)
                    │  (no CF config  │
                    │   in repo)      │
                    └────────┬────────┘
                             │ :80, :443
                    ┌────────┴────────┐
                    │  Contabo VPS    │
                    │  Ubuntu         │
                    │                 │
                    │  ┌───────────┐  │
                    │  │  Nginx    │  │  Host-level nginx
                    │  │  (host)   │  │  SSL: Let's Encrypt
                    │  │  :80, :443│  │  Proxies to 127.0.0.1:3000
                    │  └─────┬─────┘  │
                    │        │        │
                    │  ┌─────┴─────────────────┐  │
                    │  │ Docker (compose)       │  │
                    │  │                        │  │
                    │  │ network: app-network   │  │
                    │  │   bridge driver        │  │
                    │  │                        │  │
                    │  │ ┌──────────────────┐   │  │
                    │  │ │ app (Next.js)    │   │  │
                    │  │ │ container_name:  │   │  │
                    │  │ │ getirbakim-app   │   │  │
                    │  │ │ 127.0.0.1:3000   │   │  │
                    │  │ │ healthcheck: ✓   │   │  │
                    │  │ └──────────────────┘   │  │
                    │  │                        │  │
                    │  │ ┌──────────────────┐   │  │
                    │  │ │ meilisearch      │   │  │
                    │  │ │ v1.12            │   │  │
                    │  │ │ 127.0.0.1:7700   │   │  │
                    │  │ │ no healthcheck   │   │  │
                    │  │ └──────────────────┘   │  │
                    │  │                        │  │
                    │  │ ❌ No nginx in compose │  │
                    │  │ ❌ No Redis in compose │  │
                    │  └────────────────────────┘  │
                    │                 │             │
                    └─────────────────┼─────────────┘
                                      │
                            ┌─────────┴──────────┐
                            │ Supabase (SaaS)    │
                            │ - PostgreSQL       │
                            │ - Auth             │
                            │ - Storage          │
                            └────────────────────┘

                            ┌────────────────────┐
                            │ Upstash Redis      │
                            │ (SaaS, REST API)   │
                            └────────────────────┘
```

### Key Architecture Decisions (Current)

| Component | Deployment | Exposure | Notes |
|-----------|-----------|----------|-------|
| Nginx | Host (systemd or manual) | :80, :443 public | Not in Docker Compose — separate lifecycle |
| Next.js App | Docker container | `127.0.0.1:3000` only | Good — not publicly exposed |
| Meilisearch | Docker container | `127.0.0.1:7700` only | Good — localhost only |
| Redis | Upstash SaaS | REST API over HTTPS | No local Redis container — no exposure risk |
| Supabase | SaaS | External | DB/Auth/Storage — managed service |
| Cloudflare | DNS-only? | Unknown | No CF config in repo indicating Proxy/WAF setup |

---

## 2. Risks Identified

### HIGH RISK

| # | Risk | Impact | Likelihood |
|---|------|--------|------------|
| R1 | **Nginx not in Docker Compose** — separate lifecycle from app, manual SSL, manual reload | Downtime during deployments, drift between configs | High |
| R2 | **Nginx config mismatch** — `nginx/conf.d/default.conf` uses `upstream nextjs` but Docker service is `app` | If this config is deployed, nginx won't proxy correctly | Medium |
| R3 | **No Cloudflare origin lock** — origin :443 accessible from any IP, bypassing CF WAF | Direct attacks on origin server | High |
| R4 | **No nginx rate limiting** — documented as missing in `PRODUCTION_SECURITY_CHECKLIST.md` | Brute force, scraping, DDoS | Medium |
| R5 | **Nginx active config missing security headers** — `default.conf` lacks HSTS, X-Frame-Options, CSP, X-Content-Type-Options | Lower security score, potential clickjacking/MIME-sniffing | Medium |
| R6 | **Meilisearch has no Docker healthcheck** | Docker can't detect Meilisearch failures; depends_on is service_started only | Low |

### MEDIUM RISK

| # | Risk | Impact |
|---|------|--------|
| R7 | **No resource limits on Docker containers** | OOM kills, noisy neighbor |
| R8 | **No Meilisearch API key separation** — master key used for search AND admin | If search key leaks, admin access gained |
| R9 | **`nginx/conf.d/default.conf` upstream name `nextjs` doesn't match any Docker service** | Config inconsistency |
| R10 | **No Cloudflare Proxy confirmation** — unknown if orange-cloud is active | CDN/WAF may not be engaged |
| R11 | **No Brotli compression in nginx** — only gzip configured | Suboptimal compression for text assets |
| R12 | **No HTTP/2 server push or Early Hints** | Missed performance optimization |

### LOW RISK

| # | Risk | Impact |
|---|------|--------|
| R13 | `server_tokens` not disabled in active nginx config | Minor info leak (nginx version) |
| R14 | No structured logging or log aggregation | Harder troubleshooting |
| R15 | No automated SSL renewal monitoring | Cert expiry risk |

---

## 3. Security Gaps

### 3.1 Network Exposure

| Port | Current Binding | Risk Assessment |
|------|----------------|-----------------|
| 80 | Nginx on host | **OK** — needed for HTTP→HTTPS redirect + Let's Encrypt |
| 443 | Nginx on host | **OK** — main entry point |
| 3000 | `127.0.0.1:3000` in Docker | **OK** — localhost only |
| 7700 | `127.0.0.1:7700` in Docker | **OK** — localhost only, but should be internal Docker network only |

**However:** The `127.0.0.1` binding is a stopgap. Meilisearch is still accessible from the host. In Docker Compose v2+, this is fine for local dev but ideally Meilisearch should have NO port mapping at all in production (internal network only).

### 3.2 Security Headers

**Active nginx config** (`nginx/conf.d/default.conf`):
- MISSING: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP
- These ARE set in Next.js middleware but double-layering is recommended

**Example nginx config** (`docs/nginx/getirbakim.conf.example`):
- HAS: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- MISSING: CSP (only in middleware)

**Recommendation:** Set all security headers in BOTH nginx AND middleware (defense in depth).

### 3.3 TLS/SSL

| Setting | Current | Recommendation |
|---------|---------|---------------|
| TLS Protocols | TLSv1.2, TLSv1.3 | **OK** |
| SSL Ciphers | `HIGH:!aNULL:!MD5` | **Could be more restrictive** |
| SSL Session Cache | 10m shared | **OK** |
| HSTS | Middleware only | **Add to nginx also** |
| OCSP Stapling | Not configured | **Add** |

### 3.4 Admin Route Protection

- Middleware: Checks user role from Supabase token metadata
- Server-side: `requireAdminAuth()` checks DB role
- **Assessment:** Adequate but nginx-level protection for `/admin/*` would add defense in depth

---

## 4. Performance Gaps

| Gap | Current | Impact | Fix |
|-----|---------|--------|-----|
| No Brotli | gzip only | ~15-20% larger text transfers | Add `brotli on` |
| No Cloudflare CDN confirmed | Unknown proxy status | No edge caching for static assets | Enable orange-cloud |
| No HTTP/3 | HTTP/2 only | Slower initial connection | Enable HTTP/3 on nginx (requires QUIC) |
| No Meilisearch healthcheck | depends_on: service_started | App may start before Meilisearch is ready | Add healthcheck |
| No resource limits | No CPU/memory limits | Container can consume all host resources | Add limits |
| No DB connection pooling guidance | `DATABASE_POOL_MAX=4` default | Potential pool exhaustion under load | Document scaling |

---

## 5. Cloudflare Readiness Score: **3/10**

| Criterion | Status | Score |
|-----------|--------|-------|
| Orange-cloud (Proxy) active | UNKNOWN | 0/2 |
| Full (strict) SSL mode | UNKNOWN (assuming Full) | 0/2 |
| Origin certificate | No — using Let's Encrypt | 0/1 |
| CF-Connecting-IP header in nginx | Not configured | 0/1 |
| Real IP restore | Not configured | 0/1 |
| WAF rules configured | UNKNOWN | 0/1 |
| Bot Fight Mode | UNKNOWN | 0/1 |
| Cache rules for static assets | Not in CF dashboard | 0/1 |
| **Total** | | **0/10** |

Most Cloudflare readiness items are **UNKNOWN** because no Cloudflare config exists in the repo. The domain may be proxied or DNS-only.

---

## 6. Production Readiness Score: **5.5/10**

| Criterion | Score | Notes |
|-----------|-------|-------|
| Docker deployment | 7/10 | Works well, but nginx not in compose |
| Network security | 5/10 | 127.0.0.1 bindings are OK but not ideal |
| SSL/TLS | 7/10 | Let's Encrypt, modern protocols |
| Security headers | 5/10 | Dual-layered but nginx side incomplete |
| Rate limiting | 0/10 | None implemented |
| Secrets management | 8/10 | Good: .env.production on VPS only, secret-scan script |
| Health checks | 5/10 | App has healthcheck, Meilisearch doesn't |
| Observability | 3/10 | Basic: health endpoint + query monitor only |
| Backup/DR | 6/10 | Supabase backups + git tags for rollback |
| CDN/WAF | 1/10 | Cloudflare DNS may exist but no confirmed proxy |
| CI/CD | 7/10 | GitHub Actions deploy + manual deploy script |
| Resource limits | 0/10 | No CPU/memory limits on containers |
| Logging | 4/10 | Docker logs + nginx logs, no aggregation |
| **Composite** | **5.5/10** | Production-viable but not production-hardened |

---

## 7. Bottlenecks

| Bottleneck | Evidence | Impact |
|-----------|----------|--------|
| **Search caching depends on Upstash** | All product/category/hierarchy reads go through `getFromCache()` | If Upstash is slow, every page slows down |
| **Single Next.js instance** | No replica/load balancing | No HA, no zero-downtime deploy |
| **Meilisearch single instance** | No replica | Search unavailable if Meilisearch fails |
| **Nginx on host not containerized** | Separate restart/update lifecycle | Operational complexity |
| **No DB read replicas** | Supabase single instance | All queries hit primary |

---

## 8. Files Inventory

### Docker/Infrastructure Files
| File | Status | Issues |
|------|--------|--------|
| `docker-compose.yml` | Production | No resource limits, no Meilisearch healthcheck |
| `docker-compose.local.yml` | Local dev | Same as above + different port (3001) |
| `Dockerfile` | Multi-stage | Good: standalone output, healthcheck curl installed |
| `nginx/conf.d/default.conf` | Docker nginx config | **Upstream name mismatch** (`nextjs` vs `app`) |
| `docs/nginx/getirbakim.conf.example` | Reference config | Better than active config (has security headers) |

### Scripts
| File | Purpose |
|------|---------|
| `scripts/vps-deploy.sh` | Production deploy |
| `scripts/vps-rollback.sh` | Rollback |
| `scripts/vps-smoke.sh` | Smoke tests |
| `scripts/secret-scan.sh` | Secret hygiene |
| `scripts/validate-env.ts` | Environment validation |
| `scripts/live-smoke.ts` | Production smoke + SEO testing |

### Documentation
| File | Relevance |
|------|-----------|
| `docs/DEPLOYMENT_CONTABO.md` | Primary deploy guide |
| `docs/PRODUCTION_SECURITY_CHECKLIST.md` | Security checklist (incomplete) |
| `docs/OPERATIONS_RUNBOOK.md` | Day-to-day operations |
| `docs/ENVIRONMENT.md` | Env var reference |
| `docs/PRODUCTION_SECURITY_CHECKLIST.md` | Already identifies rate limiting gap |

---

## 9. Recommended Implementation Order

1. **Phase 2** — Docker network hardening (low risk, high impact)
2. **Phase 3** — Nginx production config (medium risk, high impact — must test)
3. **Phase 4** — Cloudflare optimization docs (no code changes, informational)
4. **Phase 5** — Security hardening (origin lockdown, env validation)
5. **Phase 6** — Observability docs (informational)
6. **Phase 7** — Production validation

---

## 10. Key Assumptions That Need Verification

1. **Is Cloudflare Proxy (orange-cloud) active** on getirbakim.com?
2. **Which nginx config is active on VPS?** `nginx/conf.d/default.conf` or `docs/nginx/getirbakim.conf.example`?
3. **Is `MEILI_SEARCH_KEY` configured?** Only master key visible in env. Search-only keys for frontend are best practice.
4. **Is UFW/iptables configured** to restrict port 443 to Cloudflare IPs only?
5. **Are Cron jobs configured** on the VPS for supplier sync?

---

## 11. Positive Findings (Already Well Done)

- App port bound to `127.0.0.1` only — good security baseline
- Meilisearch bound to `127.0.0.1` only — good
- Multi-stage Dockerfile with healthcheck support
- Security headers in middleware (defense in depth)
- Secret hygiene scanner (`secret-scan.sh`)
- Environment variable validator (`validate-env.ts`)
- Comprehensive operational runbook
- Git-based rollback with tags
- Redis is SaaS (Upstash) — no self-hosted exposure
- `.env.production` excluded from repo — proper secret handling
- Admin auth at both middleware AND server level

---

**Audit complete. Proceeding to Phase 2 — Docker Network Hardening.**
