// E-mail verification timings (#1258), shared by the server code, the e-mails and the client forms' copy. The legal
// texts in src/content/legal-pages.json state the same durations and change with them (docs/legal-content.md).
export const VERIFY_TTL_MINUTES = 24 * 60;
/** An unverified signup is deleted this many days after it was made (scripts/prune-attempt-rows.ts). */
export const UNVERIFIED_KEEP_DAYS = 7;
/** "24 saat": how long a verification link works, for copy. */
export const verifyLinkLifetime = `${VERIFY_TTL_MINUTES / 60} saat`;
/** "7 gün": how long an unverified signup is kept, for copy. */
export const unverifiedKeepPeriod = `${UNVERIFIED_KEEP_DAYS} gün`;
