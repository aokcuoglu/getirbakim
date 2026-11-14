# edge — neutral reverse proxy for the VPS

A standalone infrastructure unit that runs the single nginx binding **:80/:443**
for the whole VPS and terminates TLS, then proxies each request to the right
**independent** app over a shared Docker network.

It is owned by **neither** product. `getirbakim` and `bakimx` are separate
startups that happen to share one VPS; each is just an app that attaches to this
edge. No app repo runs nginx, and no app repo references the other.

```
Cloudflare ──▶ edge-nginx (:80/:443, TLS) ──▶ getirbakim-app:3000        (getirbakim.com)
                                          ├──▶ bakimx-app:3000            (bakimx.com, app.bakimx.com)
                                          └──▶ bakimx-staging-app:3000    (staging.app.bakimx.com)
```

## Layout

```
edge/
  docker-compose.yml     # edge-nginx service + external `edge` network
  deploy.sh              # validate config → (re)create edge-nginx  (idempotent)
  conf.d/
    getirbakim.conf      # getirbakim.com server blocks + edge-wide http globals
    bakimx.conf          # bakimx.com / app / staging server blocks
```

The two `conf.d/*.conf` files hold each project's routing. `getirbakim.conf`
mounts as `default.conf` (replacing nginx's stock default) and also carries the
edge-wide http globals — DNS resolver, rate-limit zones, proxy buffers — used by
both. It declares `default_server`, so include order never decides the default.

## The `edge` network

Created once, out of band, and referenced as **external** by this unit and by
every app:

```bash
docker network create edge
```

Because it is external, no `docker compose down` (in any project) ever destroys
it. Apps join it and expose a stable alias the edge targets:

**getirbakim** `docker-compose.yml` (app service):
```yaml
    networks:
      app-network:            # private: db / meili / squid
      edge:
        aliases: [getirbakim-app]
# ...
networks:
  app-network:
  edge:
    external: true
    name: edge
```

**bakimx** `docker-compose.yml` (app service) — the `proxy` network just points
at `edge` now:
```yaml
networks:
  internal:
  proxy:
    external: true
    name: edge        # was: getirbakim_app-network
```

## Deploy

```bash
bash deploy.sh
```

Validates the config in a throwaway container first, ensures the `edge` network
exists, frees :80/:443 from any legacy binder, then (re)creates `edge-nginx`.
Safe to re-run. After editing a `conf.d/*.conf`, reload without a restart:

```bash
docker exec edge-nginx nginx -s reload
```

## Certbot renewal

Certs stay host-managed under `/etc/letsencrypt` (mounted read-only). Point the
certbot **deploy-hook** at this container instead of the old per-app one:

```
--deploy-hook "docker exec edge-nginx nginx -s reload"
```

---

## Migration runbook (from the old getirbakim-owned nginx)

Until now getirbakim's compose owned the edge nginx (`getirbakim-nginx`) and the
shared network was `getirbakim_app-network`. This moves the edge here and renames
the network to `edge`. **Both sites have a short downtime window** while :80/:443
changes hands. Do it in one sitting, low-traffic.

Prereqs on the VPS: this `edge/` dir present, plus the getirbakim and bakimx repo
changes checked out (compose using the external `edge` network; getirbakim's
nginx service removed).

1. **Create the neutral network:**
   ```bash
   docker network create edge
   ```

2. **Re-attach the apps to `edge`** (no downtime yet — they keep serving via the
   old nginx until step 4). In each project dir:
   ```bash
   # getirbakim
   docker compose --env-file .env.production up -d --no-deps app
   # bakimx (prod + staging dirs)
   docker compose up -d --no-deps app
   ```
   Verify each app is now on `edge`:
   ```bash
   docker network inspect edge --format '{{range .Containers}}{{.Name}} {{end}}'
   # expect: getirbakim-app  bakimx-app-1  bakimx-staging-app...
   ```

3. **Stop the old edge** (start of the downtime window):
   ```bash
   docker rm -f getirbakim-nginx
   ```

4. **Bring up the neutral edge:**
   ```bash
   cd edge && bash deploy.sh
   ```
   `deploy.sh` also runs `docker rm -f getirbakim-nginx` and `systemctl stop
   nginx` defensively, so step 3 is belt-and-suspenders.

5. **Smoke test both sites:**
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://getirbakim.com
   curl -sS -o /dev/null -w '%{http_code}\n' https://bakimx.com
   curl -sSI https://getirbakim.com/urun/... # a real product
   ```

6. **Repoint the certbot deploy-hook** to `docker exec edge-nginx nginx -s
   reload` (renew.conf or the renewal cron), then dry-run:
   ```bash
   certbot renew --dry-run
   ```

### Rollback

If the edge misbehaves, bring the old nginx back immediately:
```bash
docker rm -f edge-nginx
cd <getirbakim>
git checkout <pre-migration-commit> -- docker-compose.yml infra/nginx
docker compose --env-file .env.production up -d nginx
```
(The `getirbakim_app-network` still exists as long as getirbakim's compose
recreates it; keep the old app attachment until the migration is confirmed.)

## Notes / gotchas

- **Only one process may bind :80/:443.** The old `getirbakim-nginx` and this
  `edge-nginx` cannot run at once — that is why step 3/4 is a hard cutover.
- **Missing app alias → 502.** If an app isn't on `edge` (or lacks its alias),
  nginx resolves the upstream at request time (runtime resolver) and returns 502
  until it appears. Config still validates; the wiring is the failure surface.
- **`docker compose down` in an app** no longer affects the edge or the other
  app — the network is external and the edge is a separate unit.
