/**
 * The release shown in the storefront footer and the /yonetim sidebar (#628). next.config.ts `env` inlines both
 * values at build time; each must be read as a direct `process.env.NAME` member access for that to work.
 */
const DEVELOPMENT_LABEL = "geliştirme";

export function appVersion(version: string | undefined, build: string | undefined) {
  const raw = (build ?? "").trim();
  const commit = !raw || raw === "development" ? null
    : /^[0-9a-f]{7,40}$/i.test(raw) ? raw.slice(0, 7).toLowerCase() : raw.slice(0, 12);
  const number = (version ?? "").trim().replace(/^v/, "");
  const tag = number ? `v${number}` : null;
  return { version: tag, commit, label: [tag, commit ?? DEVELOPMENT_LABEL].filter(Boolean).join(" · ") };
}

export const currentAppVersion = appVersion(process.env.APP_VERSION, process.env.APP_BUILD);
