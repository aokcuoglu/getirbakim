import { safeReturnTo } from "@/modules/auth/return-to";

// Where an auth form sends the visitor afterwards: an explicit `next` wins; the login page passes its own `next` on;
// anywhere else the page the dialog was opened on.
export function returnTarget(next: string | undefined, pathname: string, search: string) {
  if (next) return next;
  if (pathname === "/giris") return safeReturnTo(new URLSearchParams(search).get("next")) ?? "/";
  return pathname + search;
}

// Client-only: reads the current address, so call it from the opened dialog, never during server render.
export function currentReturnTarget(next?: string) {
  if (typeof window === "undefined") return next ?? "/";
  return returnTarget(next, window.location.pathname, window.location.search);
}
