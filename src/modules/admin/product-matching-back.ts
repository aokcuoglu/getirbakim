const base = "/yonetim/urun-eslestirme";

// A "back" path posted by a form: only this page (with an optional query) is accepted; anything else
// (other paths, "//host", schemes, "..", control characters) falls back to the plain page.
export function safeMatchingBack(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return base;
  if (!/^\/yonetim\/urun-eslestirme(\?[^#\s]*)?$/.test(value)) return base;
  return value;
}

export function withMatchingFlag(back: string, flag: string): string {
  return `${back}${back.includes("?") ? "&" : "?"}${flag}`;
}
