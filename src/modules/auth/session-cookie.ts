/**
 * A session ends after SESSION_IDLE_SECONDS without a request. The database row is the authority (currentAccount() slides it);
 * the cookie only has to outlive it. The proxy rewrites the cookie at most every SESSION_REFRESH_SECONDS, stamped in
 * SESSION_SEEN_COOKIE, because any Set-Cookie on a server action response makes Next re-render the page and wipe the
 * client router cache (#716). The cookie lasts SESSION_IDLE_SECONDS + SESSION_REFRESH_SECONDS, so a skipped refresh
 * still leaves at least SESSION_IDLE_SECONDS and never logs anyone out before the database does.
 */
export const SESSION_IDLE_SECONDS = 1800;
export const SESSION_REFRESH_SECONDS = 300;
export const SESSION_COOKIE = "gb_session";
export const SESSION_SEEN_COOKIE = "gb_session_at";
export const sessionCookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: SESSION_IDLE_SECONDS + SESSION_REFRESH_SECONDS, path: "/" });
/** Whether the session cookie should be written again: no usable stamp (missing, malformed, in the future) or one SESSION_REFRESH_SECONDS old. */
export function sessionCookieDue(seen: string | undefined, nowSeconds: number) {
 if (!seen || !/^\d+$/.test(seen)) return true;
 const at = Number(seen);
 return at > nowSeconds || nowSeconds - at >= SESSION_REFRESH_SECONDS;
}
