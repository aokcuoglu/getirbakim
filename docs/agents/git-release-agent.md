# Git / Release Agent Log

## Branch And Archive

- Working branch: `codex/v1-fast-sales`
- V0 archive tag: `v0-current-platform`

## Commit Strategy

Use small thematic commits:

1. Archive and agent documentation.
2. V1 strategy and runbook documentation.
3. V1 ParcaTedarik catalog read model and tests.
4. Storefront integration.
5. Admin matching improvements.
6. Checkout guard and smoke validation.

## Release Gates

Before a V1 release candidate:

```bash
bun run typecheck
bun test
docker compose -f docker-compose.local.yml up -d --build
curl -fsS http://127.0.0.1:3001/api/health
```

Also smoke manually:

- V1 catalog list.
- V1 product detail.
- Request CTA for unmatched product.
- Add-to-cart for purchasable product.
- Admin matching list and manual match.

## Rollback

Rollback target is the deployment commit or the `v0-current-platform` tag. If V1 database changes have been applied, verify migrations are backward compatible before rolling back the app.
