import { foldText } from "./product-name";

/**
 * Some supplier names reach the type-ahead in English ("BRAKE PAD SET, DISC BRAKE", #879). The known ones get a Turkish
 * name; an unknown name that is plainly English is left out of the suggestions instead of shown.
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
]);

const onlyEnglish = new Set(["brake", "pad", "pads", "hose", "cable", "wheel", "gasket", "switch", "valve", "belt", "bearing", "repair", "accessory", "cylinder", "caliper", "drum", "shoe", "clutch", "pump", "warning", "contact", "master", "parking", "disc", "control"]);
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
