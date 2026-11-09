/**
 * Maintenance kit ("Bakım Robotu"): the filter and engine-oil slots a vehicle's service kit is built
 * from, the 3/4/5-piece package presets, and the pure helpers the page, the composite image route and
 * the tests share. Slot products themselves come from maintenance-kit.server.ts.
 */
export type KitSlotKey = "oilFilter" | "airFilter" | "cabinFilter" | "fuelFilter" | "hydraulicFilter" | "engineOil";
export type KitSlot = {
  key: KitSlotKey; name: string;
  /** Upper-case word of the composite image's content line ("HAVA-YAĞ-POLEN"). */
  short: string;
  /** Trodo category the slot's products carry (db/source-categories.sql); engine oil is matched by spec instead. */
  categoryId: number;
  art: "filter" | "oil";
};
export const kitSlots: readonly KitSlot[] = [
  { key: "oilFilter", name: "Yağ filtresi", short: "YAĞ", categoryId: 242, art: "filter" },
  { key: "airFilter", name: "Hava filtresi", short: "HAVA", categoryId: 243, art: "filter" },
  { key: "cabinFilter", name: "Polen filtresi", short: "POLEN", categoryId: 246, art: "filter" },
  { key: "fuelFilter", name: "Yakıt filtresi", short: "YAKIT", categoryId: 244, art: "filter" },
  { key: "hydraulicFilter", name: "Hidrolik filtre", short: "HİDROLİK", categoryId: 245, art: "filter" },
  { key: "engineOil", name: "Motor yağı", short: "MOTOR YAĞI", categoryId: 957, art: "oil" },
];
export const kitSlot = (key: KitSlotKey) => kitSlots.find(slot => slot.key === key)!;
/** Slot keys in kit order, so a selection always lists its pieces the same way. */
export const orderSlotKeys = (keys: Iterable<KitSlotKey>) => kitSlots.map(slot => slot.key).filter(key => new Set(keys).has(key));

/** The packages a shopper starts from; every slot can still be switched on or off afterwards. */
export const kitPackages: readonly { size: 3 | 4 | 5; slots: readonly KitSlotKey[]; description: string }[] = [
  { size: 3, slots: ["oilFilter", "airFilter", "cabinFilter"], description: "Yağ, hava ve polen filtresi" },
  { size: 4, slots: ["oilFilter", "airFilter", "cabinFilter", "fuelFilter"], description: "3'lü set + yakıt filtresi" },
  { size: 5, slots: ["oilFilter", "airFilter", "cabinFilter", "fuelFilter", "engineOil"], description: "4'lü set + motor yağı" },
];
/** The package whose slots are exactly the selection, if any. */
export function matchingPackage(keys: Iterable<KitSlotKey>) {
  const selected = orderSlotKeys(keys).join(",");
  return kitPackages.find(pack => pack.slots.join(",") === selected) ?? null;
}

// Turkish ordinal-count suffixes follow vowel harmony: 2'li, 3'lü, 4'lü, 5'li, 6'lı, 9'lu, 10'lu.
const countSuffix: Record<number, string> = { 1: "li", 2: "li", 3: "lü", 4: "lü", 5: "li", 6: "lı", 7: "li", 8: "li", 9: "lu", 10: "lu" };
/** "3'lü", "5'li": the kit size as the storefront writes it; `upper` for the image headline ("3'LÜ"). */
export function kitCountLabel(count: number, upper = false) {
  const suffix = countSuffix[count] ?? "lı";
  return `${count}'${upper ? suffix.toLocaleUpperCase("tr") : suffix}`;
}
/** "Filtre Seti" while the kit is filters only; with engine oil it is a "Bakım Seti". */
export function kitKindLabel(keys: Iterable<KitSlotKey>) {
  return new Set(keys).has("engineOil") ? "Bakım Seti" : "Filtre Seti";
}
/** The content line under the headline: slot words in kit order ("HAVA-YAĞ-POLEN" keeps the trade's air-oil-cabin order). */
export function kitContentLine(keys: Iterable<KitSlotKey>) {
  const order: KitSlotKey[] = ["airFilter", "oilFilter", "cabinFilter", "fuelFilter", "hydraulicFilter", "engineOil"];
  const selected = new Set(keys);
  return order.filter(key => selected.has(key)).map(key => kitSlot(key).short).join("-");
}
/** "Fiat Tipo 1.4 3'lü Filtre Seti": the kit's name in the cart summary and the share text. */
export function kitName(vehicleName: string | null, keys: Iterable<KitSlotKey>) {
  const count = orderSlotKeys(keys).length;
  return [vehicleName, `${kitCountLabel(count)} ${kitKindLabel(keys)}`].filter(Boolean).join(" ");
}

/** Litres in an engine-oil product name: "4L", "5 LT", "1 Litre", "4 x 1L" (the pack, not the unit), "208 L" drums. */
export function oilPackLitres(name: string): number | null {
  const text = name.toLocaleUpperCase("tr").replace(/İ/g, "I");
  const multi = /(\d+)\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*(?:L|LT|LITRE)\b/.exec(text);
  if (multi) return Number(multi[1]) * Number(multi[2].replace(",", "."));
  const single = /(?<![0-9.,])(\d+(?:[.,]\d+)?)\s*(?:L|LT|LITRE)\b/.exec(text);
  if (!single) return null;
  const litres = Number(single[1].replace(",", "."));
  return litres > 0 && litres <= 1000 ? litres : null;
}
/** Packs needed to reach the vehicle's oil capacity (one when the pack size is unknown). */
export function oilPackQuantity(capacityLitres: number, packLitres: number | null) {
  if (!packLitres || !(capacityLitres > 0)) return 1;
  return Math.min(99, Math.max(1, Math.ceil(capacityLitres / packLitres - 1e-9)));
}

export const kitImageSize = 1200;
export const maxKitImageItems = 6;
/** Composite image of these products, in this order; the route derives slot names from the products. */
export function kitImageHref(productIds: readonly string[]) {
  return `/api/bakim-seti/gorsel?urun=${productIds.slice(0, maxKitImageItems).join(",")}`;
}
export type KitImageCell = { x: number; y: number; width: number; height: number };
/**
 * Where each product sits on the square image: the headline panel takes the top-left, the first product
 * the space beside it, the rest share the bottom band. Pure, so the same ids always give the same picture.
 */
export function kitImageLayout(count: number, size = kitImageSize): { panel: KitImageCell; cells: KitImageCell[] } {
  const items = Math.max(1, Math.min(maxKitImageItems, count));
  const gap = Math.round(size * 0.02), top = Math.round(size * 0.42);
  const panel = { x: gap, y: gap, width: Math.round(size * 0.46) - gap, height: top - gap };
  const first = { x: panel.x + panel.width + gap, y: gap, width: size - panel.width - 3 * gap, height: top - gap };
  // The bottom keeps room for the footer line.
  const bottom = 2 * gap;
  if (items === 1) return { panel, cells: [{ x: first.x, y: gap, width: first.width, height: size - gap - bottom }] };
  const rest = items - 1, bandY = top + gap, bandHeight = size - bandY - bottom;
  const cellWidth = Math.floor((size - gap * (rest + 1)) / rest);
  const cells = Array.from({ length: rest }, (_, index) => ({ x: gap + index * (cellWidth + gap), y: bandY, width: cellWidth, height: bandHeight }));
  return { panel, cells: [first, ...cells] };
}
