import { foldText } from "./fold-text";

/**
 * Some supplier names are English ("BRAKE PAD SET, DISC BRAKE", #879, #915; TecDoc type names, some cut at 24 characters).
 * The known ones get a Turkish name everywhere the store prints a product name (shownProductName in product-name.ts: cards,
 * product page, address, feed) and in the suggestions; an unknown name that is plainly English is left out of the
 * suggestions instead of shown (elsewhere it stays in its readable form). Keys are the folded words joined by one space.
 * A new entry changes the address of every product with that name: the old address 308s to the new one (product page)
 * and IndexNow reports both.
 * Single-word names ("SPRING" → "Yay", "SHAFT" → "Mil", "SWITCH" → "Şalter") are generic on purpose and may not fit every
 * product exactly. Words whose matches name different parts are deliberately left out, checked against other suppliers'
 * Turkish names for the same OE numbers: "SEAL" and "JOINT" (mostly gaskets), "ROD" (piston rods, engine mounts), "CABLE"
 * (mostly gear cables). They stay readable English on the store and are hidden from name suggestions: a missing
 * suggestion is better than one naming the wrong part.
 */
const dictionary = new Map<string, string>([
  ["brake disc", "Fren Diski"],
  ["brake pad set disc brake", "Disk Fren Balata Seti"],
  ["brake pads", "Fren Balatası"],
  ["cable parking brake", "El Freni Teli"],
  ["brake hose", "Fren Hortumu"],
  ["brake shoe set", "Fren Pabuç Seti"],
  ["wheel brake cylinder", "Fren Tekerlek Silindiri"],
  ["brake caliper", "Fren Kaliperi"],
  ["brake drum", "Fren Kampanası"],
  ["brake master cylinder", "Fren Ana Merkezi"],
  ["accessory kit", "Aksesuar Kiti"],
  ["accessory kit disc brake", "Disk Fren Aksesuar Kiti"],
  ["accessory kit brake cali", "Kaliper Aksesuar Kiti"],
  ["warning contact brake pa", "Balata İkaz Kablosu"],
  ["clutch cable", "Debriyaj Teli"],
  ["sensor", "Sensör"],
  ["hose", "Hortum"],
  ["gasket", "Conta"],
  ["set gasket", "Conta Seti"],
  ["belt", "Kayış"],
  ["bearing", "Rulman"],
  ["pump", "Pompa"],
  ["repair kit", "Tamir Takımı"],
  ["cover", "Kapak"],
  ["pipe", "Boru"],
  ["mirror", "Ayna"],
  ["housing", "Gövde"],
  ["nut", "Somun"],
  ["spring", "Yay"],
  ["bolt", "Cıvata"],
  ["tensioner", "Gergi"],
  ["radiator", "Radyatör"],
  ["plug", "Tapa"],
  // #915: the most common English names of the catalog (search_product_names, November 2026).
  ["o ring", "O-Ring Conta"],
  ["switch", "Şalter"],
  ["wheel", "Jant"],
  ["shaft", "Mil"],
  ["valve", "Valf"],
  ["seal ring", "Sızdırmazlık Halkası"],
  ["contr arm", "Salıncak"],
  ["control arm", "Salıncak"],
  ["track control arm", "Salıncak"],
  ["bolt brake disc", "Fren Diski Cıvatası"],
  ["lamp", "Lamba"],
  ["arm", "Kol"],
  ["tail light", "Stop Lambası"],
  ["wing rear light", "Dış Stop Lambası"],
  ["tailgate light", "Bagaj Kapağı Stop Lambası"],
  ["front light", "Far"],
  ["side marker light", "Yan İşaret Lambası"],
  ["pump fuel", "Yakıt Pompası"],
  ["cyl brake", "Fren Silindiri"],
  ["filter", "Filtre"],
  ["filter oil", "Yağ Filtresi"],
  ["mounting", "Takoz"],
  ["clutch", "Debriyaj"],
  ["tie rod", "Rot"],
  ["ring", "Halka"],
  ["strg wheel", "Direksiyon Simidi"],
  ["hub cover", "Jant Göbek Kapağı"],
  ["brake shoe set parking b", "El Freni Pabuç Seti"],
  ["disk brake pad", "Disk Fren Balatası"],
  ["bracket", "Braket"],
  ["screw", "Vida"],
  ["cap", "Kapak"],
  ["glass", "Cam"],
  ["cont unit", "Kontrol Ünitesi"],
  ["clamp", "Kelepçe"],
  ["silencer", "Susturucu"],
  ["door", "Kapı"],
]);

const onlyEnglish = new Set(["brake", "pad", "pads", "hose", "cable", "wheel", "gasket", "switch", "valve", "belt", "bearing", "repair", "accessory", "cylinder", "caliper", "drum", "shoe", "clutch", "pump", "warning", "contact", "master", "parking", "disc", "control", "cover", "pipe", "seal", "mirror", "housing", "nut", "spring", "bolt", "tensioner", "radiator", "joint", "plug", "link", "rod"]);
// Words English shares with Turkish names ("sensor", "kit", "set"): never enough on their own.
const shared = new Set(["sensor", "kit", "set", "of", "and", "for", "with", "front", "rear", "left", "right", "pa", "cali"]);

function words(raw: string): string[] {
  return foldText(raw).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/** The Turkish name of a known English supplier name, or undefined. */
export function turkishTypeName(raw: string): string | undefined {
  return dictionary.get(words(raw).join(" "));
}

/** Whether every word is English and at least one is English only. */
export function isEnglishTypeName(raw: string): boolean {
  const parts = words(raw);
  return parts.length > 0 && parts.every(word => onlyEnglish.has(word) || shared.has(word)) && parts.some(word => onlyEnglish.has(word));
}
