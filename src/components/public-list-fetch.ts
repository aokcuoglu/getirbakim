// The product page's lists that load the rest of themselves on request ("Uyumlu araçlar" #966, "OEM ve muadil
// numaraları" #1211). One request per list, shared by every trigger; a failed one is forgotten so "Tekrar dene" asks
// again. No cookies: the list is the same for everyone and publicly cached. Only the last few lists are kept for a page
// visited again.
const keptLists = 5;
const requests = new Map<string, Promise<unknown[]>>();
const loadedLists = new Map<string, unknown[]>();
function keep<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) if (map.size > keptLists) map.delete(oldest);
}

/** The list already loaded from `url` (a page visited again), else null. */
export function loadedPublicList<T>(url: string) {
  return (loadedLists.get(url) as T[] | undefined) ?? null;
}

/**
 * The `key` array of the JSON at `url` when every item passes `isItem`, else a rejection with `message`: an answer in
 * another shape (during a rolling deploy an older task can answer the new page's URL) takes the failed-load path
 * ("Tekrar dene") instead of breaking the page.
 */
export function publicListFetch<T>(url: string, key: "groups" | "rows", isItem: (item: unknown) => item is T, message: string) {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url, { credentials: "omit", signal: AbortSignal.timeout(10_000) }).then(async (response): Promise<T[]> => {
      const data: unknown = await response.json();
      const list: unknown = data && typeof data === "object" && key in data ? (data as Record<string, unknown>)[key] : null;
      if (!response.ok || !Array.isArray(list) || !list.every(isItem)) throw new Error(message);
      keep(loadedLists, url, list);
      return list;
    }).catch(error => {
      requests.delete(url);
      throw error;
    });
    keep(requests, url, request);
  }
  return request as Promise<T[]>;
}
