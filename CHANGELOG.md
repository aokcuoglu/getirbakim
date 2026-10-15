# Changelog

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/); see `docs/development-workflow.md`.

## v0.22.1 — 2026-10-15

Hotfix from `main`; the rest of `dev` is not included.

### Fixed
- Storefront logos and brand prefetches returned HTTP 429 under the edge rate limit on large brand grids ([#226](https://github.com/aokcuoglu/getirbakim/issues/226), [#229](https://github.com/aokcuoglu/getirbakim/pull/229)):
  - CDN cache headers for `/media/*` and `/brand/*` (public files defaulted to `max-age=0`).
  - No viewport prefetch on brand grids (home, `/automakers`, catalog popular makes).
- Site images and fonts are served from `/media/site/` instead of a third-party-named path.

### Operations
- Edge nginx: `/media/`, `/brand/` and the image API routes are exempt from the general rate/connection limits (`/opt/edge`, applied manually).
