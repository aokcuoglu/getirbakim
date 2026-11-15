/**
 * Readable product and vehicle names (#659). Supplier names are upper case ASCII ("YAG FILTRESI GENEL GENEL"); every
 * place that prints one (product page, cards, suggestions, search metadata) goes through readableProductName.
 */

const foldTable: Record<string, string> = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u", "ë": "e" };

/** Lower case ASCII form of a token, the key of the dictionary and of the text comparisons. */
export function foldText(text: string): string {
  return text.replace(/İ/g, "i").toLocaleLowerCase("tr").replace(/[çğıöşüâîûë]/g, letter => foldTable[letter]);
}

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
rotbaşı ısıtıcı önü ön astarlı kanallı kulağı kelebeği menteşesi menteşe giriş gazlı kısa çeker şanzuman büyük rezistanslı soğutmalı güvenlik lambalı çapraz yükseklik göz gözü mafsalı keçe tutacağı kılavuzu çevre farı artı özellikli konumlandırıcı kartı kamalı rölanti regülatör regülatörü yazı termiği rüzgarlığı aydınlatma aydınlatmalı`.split(/\s+/);

const dictionary = new Map<string, string>();
for (const word of turkishWords) {
  const key = foldText(word);
  // Words that fold to themselves would only re-case the default path, except those starting with "i" ("ince" → "İnce").
  if (key !== word || word.startsWith("i")) dictionary.set(key, word);
}

/** Abbreviations and codes kept as written even though they hold vowels (the vowel-less ones are kept by rule). */
const abbreviations = new Set(("ABS TDCI TCDI CRDI LCI PSA MAN DAF STD TDI HDI DCI LED EGR TSI TFSI FSI CDI CDTI JTD JTDM MJET MULTIJET OEM OE ECU LPG CNG " +
  "VTI THP HPI DTI TCE VVTI GDI MPI SDI TID VTEC DPF FAP AMG SUV MPV AWD DSG CVT ESP ASR EBD ABSLI AC BAIC BAW JAC DFSK FSO NIO NSU RUF ORA LTI LEVC KTM IZH").split(" "));

const romanNumeral = /^(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})$/;
const vowel = /[AEIOUÖÜİÂÎÛ]/;
const turkishCapital = /[ÇĞİÖŞÜ]/;

/** Upper cases the first letter (not the first character: "[cap" and "*desen" start with a mark). */
function capitalize(text: string, locale: string): string {
  const at = text.search(/\p{L}/u);
  return at < 0 ? text : text.slice(0, at) + text.charAt(at).toLocaleUpperCase(locale) + text.slice(at + 1);
}

/**
 * One token in reading form. A token holding a lower case letter ("530mm", "93°c", "iX35"), a code, a number, an
 * abbreviation or a single letter stays as written.
 */
function readableToken(token: string, afterApostrophe: boolean): string {
  if (!/\p{L}/u.test(token) || /\p{Ll}/u.test(token)) return token;
  if (/\d/.test(token) || [...token].length === 1 || romanNumeral.test(token)) return token;
  if (!vowel.test(token) || abbreviations.has(token)) return token;
  // A suffix after an apostrophe ("ABS'LI") is a plain lower case ending.
  if (afterApostrophe) return token.toLowerCase();
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
  return parts.map((part, index) => separators.test(part) ? part
    : readableToken(part, index >= 2 && apostrophes.has(parts[index - 1]) && /\p{L}$/u.test(parts[index - 2]))).join("");
}

const bare = (word: string) => word.replace(/[()[\],:;.*/]/g, "");

/** "DIS" is "diş" (tooth) after a count or beside "KALIN" / "INCE" / "SAYISI" ("12V 8 DIS", "INCE DIS", "DIS SAYISI:26"), else "dış". */
function isTooth(words: string[], index: number): boolean {
  if (bare(words[index]) !== "DIS") return false;
  const before = bare((words[index - 1] ?? "").replace(/^.*[>,]/, "")), after = bare(words[index + 1] ?? "");
  return /^\d+$/.test(before) || before === "KALIN" || before === "INCE" || after.startsWith("SAYISI");
}

/** A word written the way people write it: three letters or more, a capital then lower case or all lower case ("Litre", "Yağı"), or a unit written in lower case ("Kg", "ml"). */
const writtenWord = /^(?:\p{Lu}\p{Ll}{2,}|\p{Ll}{3,}|[Kk]g|[Mm]l|[Ll]t)$/u;

/**
 * "YAG FILTRESI GENEL GENEL" → "Yağ Filtresi". A name written for people (an admin's, the enrichment's, SETA's or a manual
 * list's: mostly lower case, or holding a word like "Litre" or "Yağı") is returned as is, so those names never change.
 * Otherwise every upper case token is converted and the tokens with a lower case letter ("530mm", "93°c") stay. A repeated
 * word is dropped only at the end of the name ("FILTRE FILTRE"): inside a model list a repeat is data ("CLIO CLIO II").
 */
export function readableProductName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  const letters = name.match(/\p{L}/gu)?.length ?? 0, lower = name.match(/\p{Ll}/gu)?.length ?? 0;
  if (lower * 2 >= letters || name.split(" ").some(word => writtenWord.test(bare(word)))) return name;
  const words = name.split(" ");
  while (words.length > 1 && words[words.length - 1] === "GENEL") words.pop();
  while (words.length > 1 && words[words.length - 1] === words[words.length - 2] && !/\d/.test(words[words.length - 1])) words.pop();
  return words.map((word, index) => isTooth(words, index) ? word.replace("DIS", "Diş") : readableWord(word)).join(" ");
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
  const short = rest.map(word => (word.match(/\p{L}/gu)?.length ?? 0) <= 3 ? word : readableWord(word)).join(" ");
  const make = words.slice(0, makeLength).map(readableWord).join(" ");
  // "MINI MINI" names the make twice.
  return { full: short && foldText(short) !== foldText(make) ? `${make} ${short}` : make, short };
}

const wordsOf = (text: string) => foldText(text).split(/[^a-z0-9]+/).filter(Boolean);

/** The word of a vehicle model that names it: its first one with a letter ("MEGANE", "A3"; "3" alone is no name). */
export function modelKeyword(model: string): string | null {
  return wordsOf(vehicleLabel(model).short).find(word => /[a-z]/.test(word) && word.length > 1) ?? null;
}

/**
 * The vehicle a product is about: the first model whose name occurs in `hint` (the supplier's name and description).
 * Without such a model the first one stands in only when the list is of one or two makes; a list across more makes
 * names no vehicle (an alphabetical first model of many makes is arbitrary: "Alfa Romeo Mito" for a Fiat part).
 */
export function primaryVehicle(models: string[], hint: string): string | null {
  const present = new Set(wordsOf(hint));
  const named = models.find(model => {
    const keyword = modelKeyword(model);
    return keyword !== null && present.has(keyword);
  });
  if (named) return named;
  return new Set(models.map(modelMake)).size <= 2 ? models[0] ?? null : null;
}
