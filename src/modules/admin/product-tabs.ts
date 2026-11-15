/** Sections of the admin product page (#584): a server-side `?tab=` choice, so only the open tab's cards load. */
export const productTabs = [
  { key: "bilgiler", label: "Mağaza bilgileri" },
  { key: "fiyat", label: "Fiyat ve kaynaklar" },
  { key: "gorseller", label: "Görseller" },
  { key: "referanslar", label: "Referanslar ve özellikler" },
  { key: "arac-uyumu", label: "Araç uyumu" },
  { key: "eslestirme", label: "Eşleştirme ve muadiller" },
  { key: "gecmis", label: "Geçmiş" },
] as const;
export type ProductTab = (typeof productTabs)[number]["key"];

/** A merged product has no cards of its own (edits live on the kept product): only its sources, matching and history. */
const mergedTabs: readonly ProductTab[] = ["fiyat", "eslestirme", "gecmis"];

export const visibleProductTabs = (merged: boolean) => productTabs.filter(tab => !merged || mergedTabs.includes(tab.key));
const defaultTab = (merged: boolean): ProductTab => merged ? "fiyat" : "bilgiler";

/** The tab asked for; an unknown or hidden value falls back to the default one. */
export function productTab(value: string | undefined, merged: boolean): ProductTab {
  return visibleProductTabs(merged).find(tab => tab.key === value)?.key ?? defaultTab(merged);
}

/** The product's tab URL. The default tab writes no `tab` parameter; the hash goes last. */
export function productTabHref(id: string, tab: ProductTab, options: { params?: Record<string, string | undefined> | URLSearchParams; hash?: string; merged?: boolean } = {}) {
  const search = new URLSearchParams();
  if (tab !== defaultTab(options.merged ?? false)) search.set("tab", tab);
  const entries = options.params instanceof URLSearchParams ? [...options.params] : Object.entries(options.params ?? {});
  for (const [key, value] of entries) if (key !== "tab" && value !== undefined) search.set(key, value);
  const text = search.toString();
  return `/yonetim/urunler/${id}${text ? `?${text}` : ""}${options.hash ? `#${options.hash}` : ""}`;
}

const anchorTabs: Record<string, ProductTab> = {
  magaza: "bilgiler", fiyat: "fiyat", gorseller: "gorseller", referanslar: "referanslar", ozellikler: "referanslar",
  "arac-uyumu": "arac-uyumu", birlestir: "eslestirme", muadil: "eslestirme", gecmis: "gecmis",
};

/** The tab holding an old `#anchor` link target (hash with or without the leading "#"); undefined for other anchors. */
export const tabOfAnchor = (hash: string): ProductTab | undefined => anchorTabs[hash.replace(/^#/, "")];
