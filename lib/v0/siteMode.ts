/**
 * v0-only site mode: interactive catalog is limited to `dpbrd` and
 * `dpprd`. Features that depend on trodo / public parts data are shown as
 * coming soon instead of being removed.
 *
 * Disabled: the "Yakında" / "Coming soon" overlay blocked all selections on
 * the site. Always returns false so all SoonFeature wrappers and comingSoon
 * branches render their real interactive content.
 */
export function isV0OnlySite(): boolean {
  return false
}
