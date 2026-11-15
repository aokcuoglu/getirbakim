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
cihazı dişi kalkanı karbüratör difüzörü volanı sızdırmazlık değiştirme süngerli döküm yardımcı ayırıcı perçin takviyesi servis gösterilen ampulü
ölçer ölçme kürek beşik yağmur kumandası gömleği evaporatör yük çok temizleyici onarım katalizör ayarlı boşaltma satış göğüs eşik zembereği
bakır bakım fırça çamur yönlendirici özel döner aparatı üstü kahverengi gündüz marş açı için çıkış gazı kenarı nikelaj kalıp
rotbaşı ısıtıcı önü ön astarlı kanallı kulağı kelebeği menteşesi menteşe giriş gazlı kısa çeker şanzuman büyük rezistanslı soğutmalı güvenlik lambalı çapraz yükseklik göz gözü mafsalı keçe tutacağı kılavuzu çevre farı artı özellikli konumlandırıcı kartı kamalı rölanti regülatör regülatörü yazı termiği rüzgarlığı aydınlatma aydınlatmalı`.split(/\s+/);

const dictionary = new Map<string, string>();
for (const word of turkishWords) {
  const key = foldText(word);
  // Words that fold to themselves ("ön" never does) would only re-case the default path; skip them to keep the table honest.
  if (key !== word) dictionary.set(key, word);
}

/** Abbreviations and codes kept as written even though they hold vowels (the vowel-less ones are kept by rule). */
const abbreviations = new Set(("ABS TDCI TCDI CRDI LCI PSA MAN DAF STD TDI HDI DCI LED EGR TSI TFSI FSI CDI CDTI JTD JTDM MJET MULTIJET OEM OE ECU LPG CNG " +
  "VTI THP HPI DTI TCE VVTI GDI MPI SDI TID VTEC DPF FAP AMG SUV MPV AWD DSG CVT ESP ASR EBD ABSLI AC BAIC BAW GAZ JAC DFSK FSO NIO NSU RUF ORA LTI LEVC KTM IZH").split(" "));

const romanNumeral = /^(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})$/;
const vowel = /[AEIOUÖÜÂÎÛ]/;

/** One upper case token in reading form, or as written when it is a code, number, abbreviation or single letter. */
function readableToken(token: string): string {
  if (!/\p{L}/u.test(token)) return token;
  if (/\d/.test(token) || [...token].length === 1 || romanNumeral.test(token)) return token;
  if (!vowel.test(token) || abbreviations.has(token)) return token;
  const known = dictionary.get(foldText(token));
  if (known) return known.charAt(0).toLocaleUpperCase("tr") + known.slice(1);
  // Plain English lower casing: "I" stays "i" and "i" becomes "I" ("INSIGNIA" → "Insignia", never "İnsignia").
  const lower = token.replace(/İ/g, "i").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const separators = /([-/(),;:+.<>&‘’“”"])/;

function readableWord(word: string): string {
  return word.split(separators).map(part => separators.test(part) ? part : readableToken(part)).join("");
}

/**
 * "YAG FILTRESI GENEL GENEL" → "Yağ Filtresi". A name with a lower case letter (an admin's, the enrichment's, SETA's
 * or a manual list's) is already written for people and is returned as is.
 */
export function readableProductName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (/\p{Ll}/u.test(name)) return name;
  const words = name.split(" ");
  while (words.length > 1 && words[words.length - 1] === "GENEL") words.pop();
  const kept = words.filter((word, index) => index === 0 || word !== words[index - 1] || /\d/.test(word));
  return kept.map(readableWord).join(" ");
}

const twoWordMakes = new Set(["ALFA ROMEO", "ASIA MOTORS", "ASTON MARTIN", "AUTO UNION", "DE LOREAN", "DE TOMASO", "EON MOTORS", "FORD AUSTRALIA", "FORD OTOSAN",
  "FORD USA", "GREAT WALL", "KG MOBILITY", "LAND ROVER", "LIVAN AUTO", "MIA ELECTRIC", "MPM MOTORS", "RAYTON FISSORE", "SWM MOTORS"]);

/**
 * "RENAULT MEGANE III Hatchback (BZ0/1_, B3_)" → full "Renault Megane III", short "Megane III": the chassis codes in
 * parentheses and the body words written in mixed case (Hatchback, Van, Bus, Platform/Chassis) are not part of the name.
 */
export function vehicleLabel(model: string): { full: string; short: string } {
  const words = model.replace(/\([^)]*\)?/g, " ").split(/\s+/).filter(word => word && !/\p{Ll}/u.test(word));
  const makeLength = words.length > 2 && twoWordMakes.has(`${words[0]} ${words[1]}`) ? 2 : 1;
  const full = words.map(readableWord).join(" ");
  const short = words.slice(makeLength).map(readableWord).join(" ");
  return { full, short: short || full };
}

const wordsOf = (text: string) => foldText(text).split(/[^a-z0-9]+/).filter(Boolean);

/** The word of a vehicle model that names it: its first one with a letter ("MEGANE", "A3"; "3" alone is no name). */
export function modelKeyword(model: string): string | null {
  return wordsOf(vehicleLabel(model).short).find(word => /[a-z]/.test(word) && word.length > 1) ?? null;
}

/**
 * The vehicle a product is about: the first model whose name occurs in `hint` (the supplier's name and description),
 * else the first model. The alphabetical first one is often a stray ("DAIHATSU ROCKY" for a Hyundai H100 filter).
 */
export function primaryVehicle(models: string[], hint: string): string | null {
  const present = new Set(wordsOf(hint));
  return models.find(model => {
    const keyword = modelKeyword(model);
    return keyword !== null && present.has(keyword);
  }) ?? models[0] ?? null;
}
