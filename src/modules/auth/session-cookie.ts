/** A session ends after this long without a request; the cookie (src/proxy.ts) and the database row slide together. */
export const SESSION_IDLE_SECONDS = 1800;
export const SESSION_COOKIE = "gb_session";
export const sessionCookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: SESSION_IDLE_SECONDS, path: "/" });
