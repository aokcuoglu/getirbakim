// The slug of a manufacturer page (/marka/<slug>, #660). Pure and dependency free: src/proxy.ts imports it.
// Same rule as product slugs (product-path.ts): "BOSCH" → "bosch", "KALE RADYATÖR" → "kale-radyator", "M.MARELLI" → "m-marelli".

const asciiLetters: Record<string, string> = { "İ": "i", "ı": "i", "Ş": "s", "ş": "s", "Ğ": "g", "ğ": "g", "Ü": "u", "ü": "u", "Ö": "o", "ö": "o", "Ç": "c", "ç": "c" };

/**
 * Lower case ASCII words joined by "-": Turkish letters map by hand (toLocaleLowerCase("tr") would turn "LUBRICO" into
 * "lubrıco"), other accents fall away, everything else separates. Empty when no letter or digit is left.
 */
export function manufacturerSlug(name: string): string {
  return name.replace(/[İıŞşĞğÜüÖöÇç]/g, letter => asciiLetters[letter]).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).join("-");
}
