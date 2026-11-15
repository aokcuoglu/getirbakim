// The storefront's one source of product addresses (#640): /urun/<slug>-<id>. The slug is brand, name and part number
// as ASCII words; the id (a uuid) alone finds the product (product-id.ts). Server and store components import it; client
// components get a finished href (it pulls in the name dictionary of readableProductName).
import { shownProductName } from "@/modules/store/product-name";
import { numberWithoutBrand } from "./product-meta";
import { productIdPath } from "./product-id";

/** What a product's address is built from: the catalog row's id, name (and whether an admin wrote it), brand and part number. */
export type ProductAddress = { id: string; name: string; name_overridden: boolean; display_brand: string; display_code: string };

export const productSlugNameLimit = 50;
export const productSlugLimit = 100;

const unspecifiedBrand = "Belirtilmemiş";
const asciiLetters: Record<string, string> = { "İ": "i", "ı": "i", "Ş": "s", "ş": "s", "Ğ": "g", "ğ": "g", "Ü": "u", "ü": "u", "Ö": "o", "ö": "o", "Ç": "c", "ç": "c" };

/**
 * Lower case ASCII words of a text: Turkish letters map by hand (toLocaleLowerCase("tr") would turn "INSIGNIA" into
 * "ınsıgnıa"), other accents fall away ("CITROËN" → "citroen"), everything else separates.
 */
function slugWords(text: string): string[] {
  return text.replace(/[İıŞşĞğÜüÖöÇç]/g, letter => asciiLetters[letter]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/** The words that fit `limit` characters (joined by "-"), cut at a word boundary; the first word stays when `keepOne` is set. */
function fitSlugWords(words: string[], limit: number, keepOne: boolean): string[] {
  const fitted: string[] = [];
  for (const word of words) {
    if (fitted.join("-").length + (fitted.length ? 1 : 0) + word.length > limit) break;
    fitted.push(word);
  }
  return fitted.length || !keepOne ? fitted : words.slice(0, 1);
}

/**
 * "bosch-fren-balatasi-arka-0986494803": brand, name and part number as ASCII words. The name is the shown one
 * (shownProductName: an admin's as written, a supplier's readable; the casing folds away, only the dropped "GENEL" and repeats remain), cut to 50
 * characters; brand and part number (without the brand's own prefix) are never cut, and the whole stays within 100
 * characters by shortening the name. "Belirtilmemiş" is no brand, a name equal to the part number is written once.
 * Empty when no word is left.
 */
export function productSlug(product: Omit<ProductAddress, "id">): string {
  const brand = product.display_brand === unspecifiedBrand ? [] : slugWords(product.display_brand);
  const number = slugWords(numberWithoutBrand(product.display_code, product.display_brand));
  const name = slugWords(shownProductName(product));
  const sameAsNumber = name.join("-") === number.join("-") || name.join("-") === slugWords(product.display_code).join("-");
  const fixed = [...brand, ...number].join("-").length;
  const room = Math.min(productSlugNameLimit, productSlugLimit - fixed - 2);
  const shown = sameAsNumber ? [] : fitSlugWords(name, room, room >= productSlugNameLimit);
  const words: string[] = [];
  for (const word of [...brand, ...shown, ...number]) if (words.at(-1) !== word) words.push(word);
  return words.join("-");
}

/** The public address of a product: `/urun/<slug>-<id>`, or `/urun/<id>` when nothing is left for a slug. */
export function productPath(product: ProductAddress): string {
  const slug = productSlug(product);
  return slug ? `/urun/${slug}-${product.id}` : productIdPath(product.id);
}
