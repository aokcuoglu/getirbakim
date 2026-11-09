export const RETURN_TO_HEADER = "x-gb-return-to";
// Only same-origin paths: "//host" and "/\host" are protocol-relative in browsers.
export function safeReturnTo(value: unknown): string | null {
 if (typeof value !== "string" || value.length > 2000) return null;
 if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f]/.test(value)) return null;
 return value;
}
export const loginPath = (next?: string | null, error?: string) => {
 const params = new URLSearchParams();
 if (error) params.set("error", error);
 const returnTo = safeReturnTo(next);
 if (returnTo && returnTo !== "/") params.set("next", returnTo);
 const query = params.toString();
 return query ? `/giris?${query}` : "/giris";
};
