// Length limits of a page's <title> and meta description (#1218). Search results show roughly 60–65 characters of a
// title and 155–160 of a description; shorter ones say too little for the page to be picked.
export const titleMin = 30;
export const titleMax = 65;
export const brandSuffix = " | Getirbakim";
export const descriptionMin = 100;
export const descriptionMax = 160;

const trailingSeparators = /[\s,.:;/-]+$/;

/** `text` cut after the last whole word that leaves room for "…" within `max`, without a dangling separator. */
function clipAtWord(text: string, max: number) {
  const cut = text.slice(0, max - 1), space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(trailingSeparators, "")}…`;
}

/**
 * The page's title for `pageMetadata`: it takes the layout's " | Getirbakim" suffix while the whole stays within 65
 * characters; a longer page title stands alone (absolute), cut at a word when it is longer than 65 on its own.
 */
export function brandedTitle(page: string): { title: string; absoluteTitle?: true } {
  if (page.length + brandSuffix.length <= titleMax) return { title: page };
  return { title: page.length > titleMax ? clipAtWord(page, titleMax) : page, absoluteTitle: true };
}

/**
 * A meta description within `max` characters: as it is when it fits; else its whole leading sentences when they make
 * at least 100 characters; else cut at a word boundary with "…".
 */
export function fitDescription(text: string, max = descriptionMax): string {
  if (text.length <= max) return text;
  // A sentence ends at ".", "!", "?" or "…" before a space: "12.345" stays one word.
  let kept = "";
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > max || !/[.!?…]$/.test(sentence)) break;
    kept = next;
  }
  return kept.length >= descriptionMin ? kept : clipAtWord(text, max);
}

/** A short listing title ("Volanlar") reads "Volanlar çeşitleri ve fiyatları"; a longer one stays as it is. */
export function listingTitlePad(page: string): string {
  return page.length < 17 ? `${page} çeşitleri ve fiyatları` : page;
}

/** The meta description of a category without curated copy: the longest of three texts that fits 160 characters. */
export function categoryDescription(name: string): string {
  const action = "Ürün kodu veya OEM numarasıyla ara, siparişten önce araç uyumluluğunu kontrol et.";
  const candidates = [
    `${name} çeşitlerini üreticiye ve teknik özelliklerine göre incele. ${action}`,
    `${name} çeşitlerini üreticiye göre incele. ${action}`,
  ];
  return candidates.find(text => text.length <= descriptionMax) ?? fitDescription(`${name} ürünlerini incele. Ürün kodu ve OEM numarasıyla uyumluluğu kontrol et.`);
}

/** /katalog's own description; the root category's curated copy stays on /kategori/yedek-parca. */
export const catalogMetaDescription = "Getirbakim yedek parça kataloğu: motor, fren, filtre ve diğer gruplardaki ürünleri üreticiye göre incele, ürün kodu veya OEM numarasıyla ara.";
