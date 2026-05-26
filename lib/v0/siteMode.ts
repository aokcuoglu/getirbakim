/**
 * v0-only site mode: interactive catalog is limited to `dbrands_match` and
 * `dpmatch`. Features that depend on trodo / public parts data are shown as
 * coming soon instead of being removed.
 */
export function isV0OnlySite(): boolean {
  return process.env.NEXT_PUBLIC_V0_ONLY_SITE !== 'false'
}
