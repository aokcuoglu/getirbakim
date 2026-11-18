export type AdsConfig = { id: string; purchaseLabel: string | null };
export type AnalyticsConfig = { ga4: string | null; ads: AdsConfig | null; metaPixel: string | null };

const match = (value: string | undefined, pattern: RegExp) => {
  const trimmed = value?.trim() ?? "";
  return pattern.test(trimmed) ? trimmed : null;
};

/**
 * Measurement ids come from the runtime environment (never NEXT_PUBLIC_, which is frozen at build); a missing or malformed
 * id loads no tag. The Google Ads purchase label only means something next to a Google Ads id.
 */
export function analyticsConfig(env: Record<string, string | undefined> = process.env): AnalyticsConfig {
  const adsId = match(env.GOOGLE_ADS_ID, /^AW-\d{6,}$/);
  return {
    ga4: match(env.GA4_MEASUREMENT_ID, /^G-[A-Z0-9]{4,}$/),
    ads: adsId ? { id: adsId, purchaseLabel: match(env.GOOGLE_ADS_PURCHASE_LABEL, /^[A-Za-z0-9_-]{6,}$/) } : null,
    metaPixel: match(env.META_PIXEL_ID, /^\d{10,20}$/),
  };
}
