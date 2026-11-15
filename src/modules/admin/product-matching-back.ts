import { z } from "zod";

const base = "/yonetim/urun-eslestirme";

// A "back" path posted by a form: only this page (with an optional query) is accepted; anything else
// (other paths, "//host", schemes, "..", fragments, whitespace and control characters) falls back to the plain page.
export function safeMatchingBack(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return base;
  if (!/^\/yonetim\/urun-eslestirme(\?[^#\s\x00-\x1f\x7f]*)?$/.test(value)) return base;
  return value;
}

// Form schema field: a missing or invalid "back" falls back to the plain page.
export const matchingBack = z.unknown().optional().transform(safeMatchingBack);

// Adds the flag(s) ("refreshed=1", "matched=bulk&count=3") to a back path; older result flags are dropped
// and every other parameter is kept.
export function withMatchingFlag(back: string, flag: string): string {
  const cut = back.indexOf("?");
  const [path, query] = cut < 0 ? [back, ""] : [back.slice(0, cut), back.slice(cut + 1)];
  const params = new URLSearchParams(query);
  params.delete("refreshed");
  params.delete("error");
  params.delete("carried_hidden");
  // Carry counts of an earlier merge (#581, #582) do not belong to the next notice.
  params.delete("images");
  params.delete("refs");
  for (const [key, value] of new URLSearchParams(flag)) params.set(key, value);
  return `${path}?${params}`;
}
