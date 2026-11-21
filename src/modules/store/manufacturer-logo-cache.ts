/**
 * Cache-Control for /api/manufacturer-logos/[key]. Only a `?v=` that matches the stored sha256 is immutable; a stale
 * or garbage version (the logo was re-encoded since the page was cached) still gets the current logo, cached briefly.
 */
export function logoCacheControl(version: string | null, sha256: string) {
  return version === sha256 ? "public, max-age=31536000, immutable" : "public, max-age=3600";
}
