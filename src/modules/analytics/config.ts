/** Measurement ids come from the runtime environment (never NEXT_PUBLIC_, which is frozen at build); a missing or malformed id loads no tag. */
export function analyticsConfig(env: Record<string, string | undefined> = process.env): { ga4: string | null } {
  const ga4 = env.GA4_MEASUREMENT_ID?.trim() ?? "";
  return { ga4: /^G-[A-Z0-9]{4,}$/.test(ga4) ? ga4 : null };
}
