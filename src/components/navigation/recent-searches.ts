import { searchTooShort } from "@/modules/search/query";

/**
 * Case- and Turkish-letter-insensitive key for de-duplicating searches. Kept local on purpose: importing the product-name
 * module would pull its dictionary into the client bundle (guarded by test-vehicle-label).
 */
function foldText(text: string): string {
  return text.replace(/İ/g, "i").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
}

export type RecentSearch = { q: string; mode: "all" | "code" };

const key = "gb-recent-searches";
const limit = 5;
const maxLength = 120;

function isRecent(value: unknown): value is RecentSearch {
  if (typeof value !== "object" || value === null) return false;
  const { q, mode } = value as Record<string, unknown>;
  return typeof q === "string" && q.length <= maxLength && !searchTooShort(q) && (mode === "all" || mode === "code");
}

/** The stored text as a list; anything malformed is dropped, nothing throws. */
export function parseRecentSearches(raw: string | null | undefined): RecentSearch[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isRecent).map(({ q, mode }) => ({ q, mode })).slice(0, limit) : [];
  } catch {
    return [];
  }
}

/** The search first, an earlier one with the same text and mode removed, at most five. */
export function addRecentSearch(list: RecentSearch[], q: string, mode: "all" | "code"): RecentSearch[] {
  const text = q.trim();
  if (text.length > maxLength || searchTooShort(text)) return list;
  const same = foldText(text);
  return [{ q: text, mode }, ...list.filter(item => !(item.mode === mode && foldText(item.q) === same))].slice(0, limit);
}

function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readRecentSearches(storage: Storage | undefined = defaultStorage()): RecentSearch[] {
  try {
    return parseRecentSearches(storage?.getItem(key));
  } catch {
    return [];
  }
}

export function saveRecentSearch(q: string, mode: "all" | "code", storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(key, JSON.stringify(addRecentSearch(readRecentSearches(storage), q, mode)));
  } catch {
    // Private mode or a full quota: the list is a convenience.
  }
}

export function clearRecentSearches(storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
