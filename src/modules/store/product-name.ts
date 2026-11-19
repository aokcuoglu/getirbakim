/**
 * Readable product and vehicle names (#659). Supplier names are upper case ASCII ("YAG FILTRESI GENEL GENEL"); every
 * place that prints one (product page, cards, suggestions, search metadata) goes through readableProductName.
 */

import { foldText } from "./fold-text";
import { turkishTypeName } from "./suggestion-names";

export { foldText };

/**
 * Turkish words that supplier names write without Turkish letters (ASCII folding lost them). Only unambiguous words are
 * listed: a wrong "correction" would break a correct name. Brands, models and abbreviations are never listed. Words
 * that fold to themselves and need no fix ("filtresi", "hortumu") are left to the default path.
 */
const turkishWords = `yağ ön sağ dış iç üst kış açma açık kapalı kapı kapağı kapaklı kapaksız lastiği contası çamurluk balatası sensörü sensör
sensörlü amortisör amortisörü radyatör radyatörü lambası rulmanı rulmanlı rulmansız aynası pompası pompalı kayış kayışı takım takımı keçesi keçeli
keçesiz körüğü camı şanzıman müşürü müşürlü başı bağlantı bağlantısı basınç basıncı ızgarası ızgara çıtası çıta çıtalı süpürgesi süpürge kasnağı
ateşleme alternatör enjektör enjektörü çizgili ısıtmalı ısıtma ısı ışık ışıklı salıncak yakıt davlumbazı yayı askı askısı çerçevesi çerçeve
çerçeveli çerçevesiz alıcı kompresörü mevsim sıcaklık çeki çubuğu çubuk delikli bandı dişlisi dişli havalı taşıyıcı taşıyıcısı dörtlü dört şarj
fıskiye fıskiyesi yıkama yıkamalı çıkış çıkışlı alüminyum poryası fitili kızdırma samandırası nikelajı nikelajlı çift çiftli yuvası küçük kaliperi
silindiri düğmesi düğme havalandırma fişi fişli sürgülü hariç çelik düz için mekanizması anahtarı sacı yağlı yağlama yağı bilyalı bilyası
havalı sıra sıvı gövdesi gövde tapası saplaması muhafazası modülü kampanası tablası rezistansı civatası plakası parçası parça flanşı flanş
reflektörü reflektör soğutucu soğutucusu soğutma genleşme süspansiyon enjeksiyon turboşarj kaplaması kırmızı ünitesi katlanır tüm hız otomatiği
sarı dönüş ambalajlı akü klimalı klimasız noktalı pabuç pabuçlu kelepçesi kelepçe kelepçeli ileri tırnak şase segmanı otobüs tankı boğaz kanalı
plastiği burç karşılığı köşe kömür farklı gömlek contalı akış takviye tuşu araçlar kauçuk eğri yüksek kasası arkası göbeği göbek kaldırma dirsek
güneşlik makarası önden kalın sonrası röle tutamağı halatı flaşör tarafı yaylı ampullü vantilatör stabilizatör kuşağı kuşak döşeme türkuaz
dağıtıcı yastığı içi şasi kabı çekme baskı mandalı katalizatör astarsız pedalı kızağı ağzı yatağı boyalı halkası tüpü şişe yeşil traktör
alçak baskısı kütle hafızalı gümüş kollektörü sürücü çalışma süzgeci geniş vidası ağız köşesi kömürü aktif şeffaf kameralı eşdeğer dönüşüm yarım
cihazı kalkanı karbüratör difüzörü volanı sızdırmazlık değiştirme süngerli döküm yardımcı ayırıcı perçin takviyesi servis gösterilen ampulü
ölçer ölçme kürek beşik yağmur kumandası gömleği evaporatör yük çok temizleyici onarım katalizör ayarlı boşaltma göğüs eşik zembereği
bakır bakım fırça çamur yönlendirici özel döner aparatı üstü kahverengi gündüz marş açı için önün sayısı araç ince ileri ikili çıkış gazı kenarı nikelaj kalıp
rotbaşı ısıtıcı önü ön astarlı kanallı kulağı kelebeği menteşesi menteşe giriş gazlı kısa çeker şanzuman büyük rezistanslı soğutmalı güvenlik lambalı çapraz yükseklik göz gözü mafsalı keçe tutacağı kılavuzu çevre farı artı özellikli konumlandırıcı kartı kamalı rölanti regülatör regülatörü yazı termiği rüzgarlığı aydınlatma aydınlatmalı
makinası üniversal minibüs direnç çekici hürlimann güçlendirilmiş güçlendirici çeneli limitörü poliüretan santrifüj partikül müsiri hüzmeli çentik distribütör empülsiyon önleyici çekişli seçici çeltik çivi çeşit içinde içten üzerinde çanağı kolçağı köşeli düğmeli amortisör çıkışı üniversalcv rölesi söndürücü ayırıcı bilezik kilitli yüzük
`.split(/\s+/);

const dictionary = new Map<string, string>();
for (const word of turkishWords) {
  const key = foldText(word);
  // Words that fold to themselves would only re-case the default path, except those starting with "i" ("ince" → "İnce").
  if (key !== word || word.startsWith("i")) dictionary.set(key, word);
}

/** Abbreviations and codes kept as written even though they hold vowels (the vowel-less ones are kept by rule). */
const technicalAbbreviations = ("GTI DXI TCI VAG DID SCE USA EPS EFI DOHC OM XU XUD DTEC NOX EV DTE TDDI " +
  // VW group engine codes ("1.9 TDI AXD", "AKL AEH")
  "AKL AEH AGR ALH AXD AXE AXB AXC AEB AVF AHL AMF ANF ACV ADR BSE ABL AAZ").split(" ");

/**
 * Model names of up to three letters that read as codes (read once from the vehicle_models table; a fixed list, so the
 * name path needs no query and no dictionary reaches the browser). Real words ("Sol", "Alt", "Far") are not here.
 */
const modelAbbreviations = ("TGA TGE TGS TGL TGM TGX KA UP RAV ASX CLA CLE GLA GLB GLC GLE GLK GLS ID XE IS AX IQ ES UX EQA EQB EQC EQE EQS EQV GTA GTE APV LFA ATS").split(" ");

const abbreviations = new Set([...modelAbbreviations, ...technicalAbbreviations, ...("ABS TDCI TCDI CRDI LCI PSA MAN DAF STD TDI HDI DCI LED EGR TSI TFSI FSI CDI CDTI JTD JTDM MJET MULTIJET OEM OE ECU LPG CNG " +
  "VTI THP HPI DTI TCE VVTI GDI MPI SDI TID VTEC DPF FAP AMG SUV MPV AWD DSG CVT ESP ASR EBD ABSLI AC BAIC BAW JAC DFSK FSO NIO NSU RUF ORA LTI LEVC KTM IZH").split(" ")]);

const romanNumeral = /^(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})$/;
const vowel = /[AEIOUÖÜİÂÎÛÉ]/;
const turkishCapital = /[ÇĞİÖŞÜ]/;

/** Upper cases the first letter (not the first character: "[cap" and "*desen" start with a mark). */
function capitalize(text: string, locale: string): string {
  const at = text.search(/\p{L}/u);
  return at < 0 ? text : text.slice(0, at) + text.charAt(at).toLocaleUpperCase(locale) + text.slice(at + 1);
}

/** Vowel of the last word of a number ("dört" → ö, "altı" → ı), as the suffix's harmony class: back/front, rounded or not. */
const numberVowels: Record<string, string> = { "0": "ı", "1": "i", "2": "i", "3": "ü", "4": "ö", "5": "e", "6": "ı", "7": "i", "8": "i", "9": "u" };
const tensVowels: Record<string, string> = { "1": "u", "2": "i", "3": "u", "4": "ı", "5": "i", "6": "ı", "7": "i", "8": "i", "9": "ı" };
const harmonized: Record<string, string> = { ı: "ı", i: "i", u: "u", ü: "ü", ö: "ü", e: "i", o: "u", a: "ı" };

/** "LU" after "4" → "lü", after "6" → "lı"; other endings, and counts that need more than the last digits, are lower cased. */
function countSuffix(token: string, count: string): string {
  const suffix = token.toLocaleLowerCase("tr");
  const match = /^l[ıiuü](k?)$/.exec(suffix);
  if (!match) return suffix;
  const digits = count.replace(/^.*?(\d+)$/, "$1");
  const last = digits.at(-1) ?? "";
  const vowelOfNumber = last !== "0" ? numberVowels[last] : digits.length === 1 ? "ı" : digits.endsWith("00") ? "ü" : tensVowels[digits.at(-2) ?? ""];
  return `l${harmonized[vowelOfNumber] ?? "ı"}${match[1]}`;
}

/**
 * One token in reading form. A token holding a lower case letter ("530mm", "93°c", "iX35"), a code, a number, an
 * abbreviation or a single letter stays as written.
 */
function readableToken(token: string, afterApostrophe: boolean, countBefore = ""): string {
  if (!/\p{L}/u.test(token) || /\p{Ll}/u.test(token)) return token;
  // A suffix after an apostrophe ("ABS'LI", "LION'S", "CEE'D") is a plain lower case ending; after a count ("4'LU") the
  // "lı/li/lu/lü" of the number's last word is restored (the ASCII source lost the ü: "dörtlü").
  if (afterApostrophe && !/\d/.test(token)) return countBefore ? countSuffix(token, countBefore) : token.toLowerCase();
  if (/\d/.test(token) || [...token].length === 1 || romanNumeral.test(token)) return token;
  if (!vowel.test(token) || abbreviations.has(token)) return token;
  const known = dictionary.get(foldText(token));
  if (known) return capitalize(known, "tr");
  // A word with Turkish capitals is Turkish: "I" is dotless there ("ÇAPI" → "Çapı", "İLERİ" → "İleri").
  if (turkishCapital.test(token)) return capitalize(token.toLocaleLowerCase("tr"), "tr");
  // Plain English lower casing: "I" stays "i" and "i" becomes "I" ("INSIGNIA" → "Insignia", never "İnsignia").
  return capitalize(token.toLowerCase(), "en");
}

const separators = /([-/(),;:+.<>&‘’“”"[\]{}*'=?#])/;
const apostrophes = new Set(["'", "’"]);

function readableWord(word: string): string {
  const parts = word.split(separators);
  return parts.map((part, index) => {
    if (separators.test(part)) return part;
    const after = index >= 2 && apostrophes.has(parts[index - 1]);
    const before = after ? parts[index - 2] : "";
    // "PICK-UP" is the truck body, not the model "Up".
    if (part === "UP" && parts[index - 1] === "-") return "Up";
    return readableToken(part, after && /[\p{L}\d]$/u.test(before), /\d$/.test(before) ? before : "");
  }).join("");
}

const bare = (word: string) => word.replace(/[()[\],:;.*/]/g, "");

/** "DIS" is "diş" (tooth) after a count or beside "KALIN" / "INCE" / "SAYISI" ("12V 8 DIS", "INCE DIS", "DIS SAYISI:26"), else "dış". */
function isTooth(words: string[], index: number): boolean {
  if (bare(words[index]) !== "DIS") return false;
  const before = bare((words[index - 1] ?? "").replace(/^.*[>,]/, "")), after = bare(words[index + 1] ?? "");
  // "DIS FREZE" is the outer milling cutter even after a count ("2 DIS FREZE").
  if (/^FRE{1,2}ZE/.test(after)) return false;
  return /^\d+$/.test(before) || before === "KALIN" || before === "INCE" || after.startsWith("SAYISI");
}

/** Words an abbreviation of the list would misread: "PICK UP" (body type, not the model "Up"), "IS MAKINASI" ("iş makinası"). */
function isLiteralWord(words: string[], index: number): string | undefined {
  const word = bare(words[index]);
  if (word === "UP" && bare(words[index - 1] ?? "") === "PICK") return words[index].replace("UP", "Up");
  if (word === "IS" && /^MAKIN/.test(bare(words[index + 1] ?? ""))) return words[index].replace("IS", "İş");
  return undefined;
}

/**
 * "YAG FILTRESI GENEL GENEL" → "Yağ Filtresi". A name written for people (an admin's, the enrichment's, SETA's or a manual
 * list's: a third or more of its letters lower case) is returned as is, so those names never change.
 * Otherwise every upper case token is converted and the tokens with a lower case letter ("530mm", "93°c") stay. A repeated
 * word is dropped only at the end of the name ("FILTRE FILTRE"): inside a model list a repeat is data ("CLIO CLIO II").
 */
export function readableProductName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  const letters = name.match(/\p{L}/gu)?.length ?? 0, lower = name.match(/\p{Ll}/gu)?.length ?? 0;
  if (lower * 3 >= letters) return name;
  const words = name.split(" ");
  while (words.length > 1 && words[words.length - 1] === "GENEL") words.pop();
  while (words.length > 1 && words[words.length - 1] === words[words.length - 2] && !/\d/.test(words[words.length - 1])) words.pop();
  return words.map((word, index) => isTooth(words, index) ? word.replace("DIS", "Diş") : isLiteralWord(words, index) ?? readableWord(word)).join(" ");
}

/**
 * The name a store surface prints for a catalog row (#686, #915): an admin's override as written (`name_overridden`, set by
 * the catalog views); else the Turkish name of a known English supplier type name ("BRAKE PAD SET, DISC BRAKE" → "Disk Fren
 * Balata Seti", suggestion-names.ts); else the supplier's name in its readable form (an unknown English name stays readable).
 * The product page puts the enrichment's name between the admin's and this one (productTitle). Cards, suggestions,
 * analytics, the page and the product address all read it, so they never disagree.
 */
export function shownProductName(product: { name: string; name_overridden: boolean }): string {
  return product.name_overridden ? product.name : turkishTypeName(product.name) ?? readableProductName(product.name);
}

/** Letters and digits only, folded: "DF 7458-S" and "df7458s" compare equal. */
function compact(text: string): string {
  return foldText(text).replace(/[^a-z0-9]/g, "");
}

/**
 * The title without the brand and part number a supplier name ends with ("… 4X4 TRW DF7458S" → "… 4X4"); the page prints both
 * in their own block (#702). Case, spacing and dashes of the code do not matter. Rules, so vehicle years and specs survive:
 * - several trailing words are joined to match the code only when the code itself is written split ("DF 7458", "W-712");
 * - a purely numeric code of up to 4 digits is stripped only when the brand stands right before it;
 * - the brand is stripped only together with the code (before or after it), never alone: "Yağ Filtresi Fiat" keeps Fiat,
 *   because for original-part brands (FIAT, FORD) the brand is also the vehicle make.
 * A title that would end up empty, or as just the brand or the code, is returned as is.
 */
export function titleWithoutIdentity(title: string, brand: string, partNumber: string): string {
  const brandKeys = [...new Set([compact(brand), compact(brand.trim().split(/[\s-]+/)[0])].filter(Boolean))], codeKey = compact(partNumber);
  if (!codeKey) return title;
  const split = /[\s\-.]/.test(partNumber.trim());
  const shortNumber = /^\d{1,4}$/.test(codeKey);
  const tailLength = (words: string[], keys: string[], joined: boolean): number => {
    for (let take = joined ? Math.min(4, words.length) : 1; take >= 1; take--) {
      if (words.length >= take && keys.includes(compact(words.slice(-take).join("")))) return take;
    }
    return 0;
  };
  const words = title.trim().split(/\s+/);
  const stripBrand = (list: string[]): boolean => {
    const take = tailLength(list, brandKeys, true);
    if (take === 0 || take >= list.length) return false;
    list.length -= take;
    return true;
  };
  let changed = false;
  for (;;) {
    const take = tailLength(words, [codeKey], split);
    if (take > 0 && take < words.length) {
      const rest = words.slice(0, -take);
      if (shortNumber && !(tailLength(rest, brandKeys, true) > 0 && tailLength(rest, brandKeys, true) < rest.length)) break;
      words.length -= take;
      stripBrand(words);
      changed = true;
      continue;
    }
    const trial = [...words];
    if (stripBrand(trial) && tailLength(trial, [codeKey], split) > 0 && tailLength(trial, [codeKey], split) < trial.length) {
      words.length = trial.length;
      continue;
    }
    break;
  }
  const result = words.join(" ").replace(/[\s,;:\-–/(]+$/, "");
  if (!changed || !result || brandKeys.includes(compact(result)) || compact(result) === codeKey) return title;
  return result;
}

const twoWordMakes = new Set(["ALFA ROMEO", "ASIA MOTORS", "ASTON MARTIN", "AUTO UNION", "DE LOREAN", "DE TOMASO", "EON MOTORS", "FORD AUSTRALIA", "FORD OTOSAN",
  "FORD USA", "GREAT WALL", "KG MOBILITY", "LAND ROVER", "LIVAN AUTO", "MIA ELECTRIC", "MPM MOTORS", "RAYTON FISSORE", "SWM MOTORS"]);

/** Body styles and variants TecDoc appends to a model name; they are no part of the model ("Hatchback", "Station Wagon"). */
const bodyWords = new Set(["VAN", "COUPE", "SALOON", "CONVERTIBLE", "HATCHBACK", "ESTATE", "PLATFORM/CHASSIS", "BUS", "PICKUP", "BOX", "BODY/MPV", "BODY/ESTATE",
  "WAGON", "VEHICLE", "OFF-ROAD", "CAB", "TURNIER", "ROADSTER", "TOURING", "TOURER", "STATION", "VARIANT", "BREAK", "CLOSED", "SPORTBACK", "OPEN", "AVANT", "CREW",
  "TARGA", "BERLINA", "COMBI", "VOLANTE", "T-MODEL", "EXTENDED", "CABRIOLET", "CABRIO", "SPORTS", "KOMBI", "SPYDER", "STANDARD", "COUNTRY", "TRAVELLER", "TOP",
  "LIFTBACK", "FASTBACK", "CAMPER", "TURISMO", "SHOOTING", "PICK", "GRANDTOUR", "COMPACT", "BRAKE", "UNIVERSAL", "PANORAMA", "MPV", "SPORTWAGON", "SW", "LIMOUSINE",
  "ALL-TERRAIN", "SEDAN", "FLATBED/CHASSIS", "CROSSOVER", "TRUCK", "MK", "WEEKEND"]);

type Label = { full: string; short: string };

/** The make of a model name ("RENAULT MEGANE III …" → "RENAULT"; "LAND ROVER DEFENDER" → "LAND ROVER"). */
export function modelMake(model: string): string {
  const words = model.replace(/\([^)]*\)?/g, " ").split(/\s+/).filter(Boolean);
  return words.length >= 2 && twoWordMakes.has(`${words[0]} ${words[1]}`.toUpperCase()) ? `${words[0]} ${words[1]}`.toUpperCase() : (words[0] ?? "").toUpperCase();
}

/**
 * "RENAULT MEGANE III Hatchback (BZ0/1_, B3_)" → full "Renault Megane III", short "Megane III": the chassis codes in
 * parentheses and the listed body words (Hatchback, Van, Bus, Platform/Chassis) are not part of the name. Model words of up
 * to three letters ("CLA", "TGA") stay as written, and a model of only a make has an empty short label: nothing to name.
 */
export function vehicleLabel(model: string): Label {
  const words = model.replace(/\([^)]*\)?/g, " ").split(/\s+/).filter(Boolean);
  const makeLength = words.length >= 2 && twoWordMakes.has(`${words[0]} ${words[1]}`.toUpperCase()) ? 2 : 1;
  const rest = words.slice(makeLength).filter((word, index) => index === 0 || !(bodyWords.has(word.toUpperCase()) || /^\d+(,\d+)?-t$/i.test(word)));
  // A name of only a body word ("MINI Hatchback") names no model.
  const short = rest.length === 1 && bodyWords.has(rest[0].toUpperCase()) ? "" : rest.map(word => (word.match(/\p{L}/gu)?.length ?? 0) <= 3 ? word : readableWord(word)).join(" ");
  const make = words.slice(0, makeLength).map(readableWord).join(" ");
  // "MINI MINI" names the make twice.
  return { full: short && foldText(short) !== foldText(make) ? `${make} ${short}` : make, short };
}

const wordsOf = (text: string) => foldText(text).split(/[^a-z0-9]+/).filter(Boolean);

/** The word of a vehicle model that names it: its first one with a letter ("MEGANE", "A3"; "3" alone is no name). */
export function modelKeyword(model: string): string | null {
  return wordsOf(vehicleLabel(model).short).find(word => /[a-z]/.test(word) && word.length > 1) ?? null;
}

/** The make of a model in reading form ("LAND ROVER DEFENDER" → "Land Rover"). */
export function makeLabel(model: string): string {
  return readableProductName(modelMake(model));
}

/**
 * The vehicle a product is about, or null when no single model can be named. A list across more than two makes names
 * none, even when the hint matches a model (a match among many makes is a coincidence). Otherwise it is the first model
 * whose name occurs in `hint` (the supplier's name and description), or the only model of the list (different body
 * variants of one model count as one). A list of several models that the hint does not name stays unnamed: the first
 * of them would be arbitrary ("Alfa Romeo Mito" for a Fiat part).
 */
export function primaryVehicle(models: string[], hint: string): string | null {
  if (new Set(models.map(modelMake)).size > 2) return null;
  const present = new Set(wordsOf(hint));
  const named = models.find(model => {
    const keyword = modelKeyword(model);
    return keyword !== null && present.has(keyword);
  });
  if (named) return named;
  return new Set(models.map(model => vehicleLabel(model).full)).size === 1 ? models[0] : null;
}

/** The make shared by a list of models none of which stands out (one make; two or more makes name no vehicle). */
export function commonMake(models: string[]): string | null {
  return models.length > 0 && new Set(models.map(modelMake)).size === 1 ? makeLabel(models[0]) : null;
}
