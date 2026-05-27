# Cloudflare Production Setup — GetirBakim V2

**Last updated:** 2026-05-27
**Domain:** getirbakim.com

---

## 1. Pre-Flight Checklist

Before configuring Cloudflare, verify:

- [ ] DNS is managed by Cloudflare (nameservers point to CF)
- [ ] Origin server (Contabo VPS) is running the hardened Docker stack
- [ ] Nginx is serving on ports 80 and 443 (via Docker)
- [ ] `https://getirbakim.com` works directly (before CF proxy)
- [ ] Let's Encrypt SSL certs are valid on the origin
- [ ] `.env.production` has correct production values
- [ ] `NEXT_PUBLIC_SITE_URL=https://getirbakim.com`
- [ ] UFW allows only Cloudflare IP ranges on port 443 (see `docs/cloudflare-origin-lockdown.md`)

---

## 2. SSL/TLS Settings

### Cloudflare Dashboard → SSL/TLS → Overview

| Setting | Value | Why |
|---------|-------|-----|
| SSL/TLS encryption mode | **Full (strict)** | Requires valid cert on origin — prevents MITM |
| Always Use HTTPS | **ON** | Redirects all HTTP to HTTPS at CF edge |
| HTTP Strict Transport Security (HSTS) | **ON** | CF adds HSTS header at edge (defense in depth) |
| Minimum TLS Version | **1.2** | Drop TLS 1.0/1.1 support |
| Opportunistic Encryption | **ON** | HTTPS for resources when scheme is HTTP (legacy) |
| TLS 1.3 | **ON** | Modern, faster TLS |
| Automatic HTTPS Rewrites | **ON** | Fixes mixed content automatically |

### Why Full (strict), NOT Flexible

- **Flexible**: CF-to-origin uses HTTP — traffic is decrypted at CF edge and sent plaintext. Anyone between CF and your origin can snoop.
- **Full**: CF-to-origin uses HTTPS but accepts self-signed/invalid certs — better but not ideal.
- **Full (strict)**: CF-to-origin uses HTTPS with VALID certificate validation. Origin must have a valid cert from a public CA (Let's Encrypt is fine).

### Origin Certificate Alternative

If you prefer Cloudflare Origin CA certs over Let's Encrypt:
1. Go to SSL/TLS → Origin Server → Create Certificate
2. Generate a 15-year origin cert
3. Install on VPS at `/etc/letsencrypt/live/getirbakim.com/`
4. Update nginx to use the CF origin cert + key
5. Set SSL mode to Full (strict)

Our nginx config supports either. Let's Encrypt is auto-renewed; CF Origin CA is manual.

---

## 3. Performance Settings

### Cloudflare Dashboard → Speed → Optimization

| Setting | Value | Why |
|---------|-------|-----|
| **Brotli** | **ON** | Compresses text assets 15-20% more than gzip |
| **Early Hints** | **ON** | Preloads critical resources before page renders |
| **HTTP/2 to Origin** | **ON** | Faster multiplexed connections to origin |
| **HTTP/3 (with QUIC)** | **ON** | Faster initial connection, better mobile perf |
| **0-RTT Connection Resumption** | **ON** | Instant reconnect for returning visitors |
| **Rocket Loader** | **OFF** | Can break Next.js JS bundles — keep off |

### Cloudflare Dashboard → Speed → Content Optimization

| Setting | Value |
|---------|-------|
| Auto Minify — JavaScript | **ON** |
| Auto Minify — CSS | **ON** |
| Auto Minify — HTML | **ON** |
| Polish (image optimization) | **ON (Lossless)** |
| Mirage (mobile image optimization) | **ON** |

### Polish — Lossless vs Lossy

- **Lossless**: Strips metadata, recompresses without quality loss — always safe
- **Lossy**: Reduces file size more aggressively — may affect image quality
- Recommendation: Start with **Lossless**, monitor product image quality

---

## 4. Caching Strategy

### Cloudflare Dashboard → Caching → Cache Rules

Create the following Cache Rules:

#### Rule 1: Static Next.js Assets — Cache 1 Month

```
When: URI Path starts with /_next/static/
Then: Eligible for cache
      Edge TTL: 1 month
      Browser TTL: 1 year
      Cache Deception Armor: ON
```

#### Rule 2: Next.js Image Optimization — Cache 1 Day

```
When: URI Path starts with /_next/image
Then: Eligible for cache
      Edge TTL: 1 day
      Browser TTL: 1 day
```

#### Rule 3: Category Pages — Cache 10 Minutes

```
When: URI Path starts with /tr/category/ or /en/category/
Then: Eligible for cache
      Edge TTL: 10 minutes
      Browser TTL: 2 minutes
```

#### Rule 4: Product Pages — Cache 5 Minutes

```
When: URI Path starts with /tr/product/ or /en/product/
Then: Eligible for cache
      Edge TTL: 5 minutes
      Browser TTL: 1 minute
```

#### Rule 5: SEO Files — Cache 1 Hour

```
When: URI Path contains sitemap.xml or robots.txt
Then: Eligible for cache
      Edge TTL: 1 hour
      Browser TTL: 1 hour
```

### NEVER Cache (Bypass Cache)

Create a Cache Rule with:

```
When: URI Path starts with /api/
      OR URI Path starts with /cart
      OR URI Path starts with /checkout
      OR URI Path starts with /account
      OR URI Path starts with /profile
      OR URI Path contains /admin
      OR URI Path contains /auth/callback
Then: Bypass cache
```

#### Additional Cache Bypass — Cookie-Based

For dynamic pages (cart, account), set:

```
Edge Cache TTL → Respect existing headers
```

The Next.js middleware already sets `Cache-Control` headers appropriately:
- Authenticated users (have auth cookies): dynamic content
- Anonymous users: `Cache-Control: public, s-maxage=300, stale-while-revalidate=900`

---

## 5. Security Settings

### Cloudflare Dashboard → Security

| Setting | Value | Why |
|---------|-------|-----|
| **Security Level** | **Medium** | Challenges suspicious visitors |
| **Challenge Passage** | **30 minutes** | Return visitors not re-challenged |
| **Browser Integrity Check** | **ON** | Blocks known bad bots |
| **Privacy Pass** | **ON** | Reduces CAPTCHAs for legitimate users |

### Cloudflare Dashboard → Security → Bots

| Setting | Value |
|---------|-------|
| **Bot Fight Mode** | **ON** |
| **Block AI Bots** | **ON** (blocks GPTBot, ClaudeBot, etc. from scraping) |
| **Verified Bots** | Allow Googlebot, Bingbot, Yandex, etc. |

### Cloudflare Dashboard → Security → WAF

Create the following WAF Custom Rules:

#### Rule: Block Known Vulnerability Scanners

```
When: Threat Score > 25
      OR Known Bots
Then: Managed Challenge
```

#### Rule: Rate Limiting — Search Endpoint

```
When: URI Path starts with /api/search
      AND Request Method is GET or POST
Then: Block for 10 minutes
      When rate exceeds 30 requests per 10 seconds
      Group by: IP
```

#### Rule: Rate Limiting — Auth Endpoints

```
When: URI Path matches /api/auth/* or /auth/callback
      AND Request Method is POST
Then: Block for 1 hour
      When rate exceeds 5 requests per 10 seconds
      Group by: IP
```

#### Rule: Rate Limiting — Admin

```
When: URI Path contains /admin
Then: Block for 1 hour
      When rate exceeds 20 requests per 10 seconds
      Group by: IP
```

### Cloudflare Dashboard → Security → DDoS

| Setting | Value |
|---------|-------|
| DDoS protection | **ON** (default for all plans) |
| Ruleset sensitivity | **Medium** (default) |
| Ruleset action | **Managed Challenge** |

---

## 6. Network Settings

### Cloudflare Dashboard → Network

| Setting | Value | Notes |
|---------|-------|-------|
| HTTP/2 | **ON** | Already on by default |
| HTTP/3 (with QUIC) | **ON** | Requires Speed → Optimization toggle |
| 0-RTT Connection Resumption | **ON** | May replay non-idempotent requests — safe for GET |
| IPv6 Compatibility | **ON** | Origin doesn't need IPv6 — CF handles translation |
| gRPC | **OFF** | Not used |
| WebSockets | **ON** | For Next.js HMR and realtime features |
| IP Geolocation | **ON** | Sends CF-IPCountry header to origin |
| Onion Routing | **OFF** | Not needed for e-commerce |
| Pseudo IPv4 | **OFF** | Origin gets real IPv4 already |

---

## 7. DNS Records

### Required DNS Configuration

| Type | Name | Content | Proxy Status | TTL |
|------|------|---------|-------------|-----|
| A | `getirbakim.com` | `<VPS-IP>` | Proxied (orange) | Auto |
| A | `www` | `<VPS-IP>` | Proxied (orange) | Auto |
| CNAME | `www` | `getirbakim.com` | Proxied (orange) | Auto |

The `www` record can be either A or CNAME — both work. CNAME allows changing origin IP without updating multiple records.

### Backup / Dev Records

| Type | Name | Content | Proxy Status | TTL |
|------|------|---------|-------------|-----|
| A | `direct` | `<VPS-IP>` | DNS only (gray) | Auto |

The `direct` subdomain bypasses Cloudflare proxy — useful for:
- Direct SSH without CF proxying
- Emergency origin access when CF is down
- Firewall rules should still restrict this

---

## 8. Page Rules (Legacy) vs Cache Rules

Cloudflare is migrating from Page Rules to Cache Rules. **Use Cache Rules** (newer, more flexible) for all caching configuration. Page Rules are deprecated and have a 3-rule limit on free plans.

If you must use Page Rules:

1. `getirbakim.com/_next/static/*` → Cache Level: Cache Everything, Edge Cache TTL: 1 month
2. `getirbakim.com/api/*` → Cache Level: Bypass
3. `getirbakim.com/*admin*` → Cache Level: Bypass, Security Level: High

---

## 9. Scrape Shield

### Cloudflare Dashboard → Scrape Shield

| Setting | Value | Why |
|---------|-------|-----|
| Email Address Obfuscation | **ON** | Prevents email scraping by bots |
| Server-side Excludes | **ON** | Hides sensitive content from suspicious visitors |
| Hotlink Protection | **ON** | Prevents other sites from embedding your images |

Hotlink Protection → add allowed domains:
- `getirbakim.com`
- `www.getirbakim.com`
- `*.getirbakim.com`

---

## 10. Zaraz (Optional)

Cloudflare Zaraz can load third-party tools (analytics, chat, ads) without impacting page performance. If using:
- CookieYes consent — load via Zaraz
- Google Analytics — load via Zaraz
- Facebook Pixel — load via Zaraz

---

## 11. Verification Checklist

After all settings are applied:

- [ ] `curl -I https://getirbakim.com` shows `cf-cache-status: HIT` or `MISS`
- [ ] `curl -I https://getirbakim.com` shows `server: cloudflare` (NOT nginx)
- [ ] `curl -I https://getirbakim.com/api/health` shows `cf-cache-status: BYPASS`
- [ ] `curl -I https://getirbakim.com/_next/static/<hash>.js` shows `cf-cache-status: HIT`
- [ ] Search still works: `https://getirbakim.com/tr/product/<slug>`
- [ ] Category pages load: `https://getirbakim.com/tr/category/<slug>`
- [ ] Admin login works: `https://getirbakim.com/tr/admin`
- [ ] WAF test: `curl -H "User-Agent: zgrab" https://getirbakim.com/` → should be blocked
- [ ] SSL test: https://www.ssllabs.com/ssltest/analyze.html?d=getirbakim.com
- [ ] Security headers: `curl -I https://getirbakim.com` shows HSTS, X-Frame-Options, CSP
- [ ] No nginx version leaked: `curl -I https://getirbakim.com` should NOT show `Server: nginx/x.y.z`

---

## 12. Ongoing Maintenance

### Certificate Renewal

If using Let's Encrypt on origin:
- Certbot runs on VPS via cron/systemd timer
- Post-hook reloads docker nginx: `docker compose exec nginx nginx -s reload`

### Cache Purging

To purge cache after deployment:
1. Cloudflare Dashboard → Caching → Configuration → Purge Everything
2. Or use API: `curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" -H "Authorization: Bearer <API_TOKEN>" -H "Content-Type: application/json" --data '{"purge_everything":true}'`

### Monitor

- Cloudflare Analytics: Traffic, bandwidth, threats blocked
- Cloudflare Security Events: WAF matches, rate limiting triggers
- Origin health: UptimeRobot or similar monitoring

---

## 13. API Token (for automation)

Create a scoped API token at Cloudflare Dashboard → My Profile → API Tokens:

```
Permissions needed: Zone.Cache Purge, Zone.Zone Read, Zone.Analytics Read
Zone Resources: Include → Specific Zone → getirbakim.com
```

Store token securely — never in repo.
