import { specificationLabel, specificationValue } from "./catalog-filters";

/**
 * Turkish names for the enrichment's English specification keys (#622), keyed by the lower-cased name without its
 * trailing unit ("[mm]") and index ("1"), so "Outer Diameter", "Outer Diameter [mm]" and "Outer Diameter 1 [mm]" share one
 * entry. Covers the keys that make up ~95% of the untranslated labels in the enrichment data. The product page and
 * catalog.ts import this (both server side): the catalog cards ship catalog-filters to the browser and must stay small.
 */
const labels: Record<string, string> = {
  "supplementary article/supplementary info": "İlave ürün/bilgi",
  "material": "Malzeme",
  "inner diameter": "İç çap",
  "length": "Uzunluk",
  "paired article number": "Çift halindeki ürün numarası",
  "height": "Yükseklik",
  "width": "Genişlik",
  "outer diameter": "Dış çap",
  "guarantee": "Garanti",
  "diameter": "Çap",
  "voltage": "Voltaj",
  "thickness": "Kalınlık",
  "number of pins": "Pim sayısı",
  "svhc": "SVHC (çok yüksek önem arz eden madde)",
  "colour": "Renk",
  "eu general product safety regulation (gpsr)": "AB Genel Ürün Güvenliği Yönetmeliği (GPSR)",
  "eu general product safety regulation": "AB Genel Ürün Güvenliği Yönetmeliği",
  "test mark": "Test işareti",
  "weight": "Ağırlık",
  "operating mode": "Çalışma şekli",
  "registration type": "Onay türü",
  "packaging height": "Ambalaj yüksekliği",
  "packaging width": "Ambalaj genişliği",
  "packaging length": "Ambalaj uzunluğu",
  "inlet diameter": "Giriş çapı",
  "outlet diameter": "Çıkış çapı",
  "thread size": "Diş ölçüsü",
  "number of teeth": "Diş sayısı",
  "wear warning contact": "Aşınma uyarı kontağı",
  "core width": "Petek genişliği",
  "core depth": "Petek derinliği",
  "core length": "Petek uzunluğu",
  "number of ribs": "Nervür sayısı",
  "control/trailing arm type": "Salıncak/kol tipi",
  "spanner size": "Anahtar ağzı ölçüsü",
  "number of connectors": "Konnektör sayısı",
  "brake system": "Fren sistemi",
  "for oe number": "OE numarası için",
  "model": "Model",
  "external thread size": "Dış diş ölçüsü",
  "net weight": "Net ağırlık",
  "wva number": "WVA numarası",
  "radiator type": "Radyatör tipi",
  "cable length": "Kablo uzunluğu",
  "shock absorber mounting type": "Amortisör bağlantı tipi",
  "centering diameter": "Merkezleme çapı",
  "article number of recommended accessories": "Önerilen aksesuarların ürün numarası",
  "shock absorber design": "Amortisör yapı tipi",
  "manufacturer restriction": "Üretici kısıtı",
  "bolt hole circle ø": "Bijon delik çemberi Ø",
  "brake disc thickness": "Fren diski kalınlığı",
  "rod/strut": "Rot/destek",
  "socket type bulb": "Ampul duy tipi",
  "belt pulley ø": "Kayış kasnağı Ø",
  "minimum thickness": "Minimum kalınlık",
  "vehicle equipment": "Araç donanımı",
  "bore diameter": "Delik çapı",
  "bore diameter up to": "Maksimum delik çapı",
  "thread length": "Diş uzunluğu",
  "quantity": "Adet",
  "number of grooves": "Kanal sayısı",
  "cone size": "Konik ölçüsü",
  "rotation direction": "Dönüş yönü",
  "refrigerant": "Soğutucu akışkan",
  "pulleys": "Kasnaklar",
  "light function": "Aydınlatma fonksiyonu",
  "sensor type": "Sensör tipi",
  "left-hand/right-hand traffic": "Sol/sağ trafik",
  "belt material": "Kayış malzemesi",
  "parameter": "Parametre",
  "left-/right-hand drive vehicles": "Sol/sağ direksiyonlu araçlar",
  "tightening torque": "Sıkma torku",
  "light design": "Aydınlatma yapısı",
  "rated power": "Anma gücü",
  "piston rod diameter": "Piston mili çapı",
  "tensile cord material": "Gerdirme kordu malzemesi",
  "connector shape": "Konnektör şekli",
  "cooling fin material": "Soğutma kanatçığı malzemesi",
  "goods tariff number": "Gümrük tarife numarası",
  "water pump impeller material": "Su pompası çarkı malzemesi",
  "container type": "Ambalaj tipi",
  "piston diameter": "Piston çapı",
  "internal thread size": "İç diş ölçüsü",
  "gasket/seal design": "Conta/keçe yapısı",
  "chain type": "Zincir tipi",
  "housing colour": "Gövde rengi",
  "number of chain links": "Zincir baklası sayısı",
  "cooling hose": "Soğutma hortumu",
  "fulfils ece standard": "ECE standardı",
  "water tank material": "Su kutusu malzemesi",
  "thread type": "Diş tipi",
  "housing type": "Gövde tipi",
  "lens colour (direction indicator)": "Mercek rengi (sinyal)",
  "lens colour": "Mercek rengi",
  "overall length": "Toplam uzunluk",
  "total length": "Toplam uzunluk",
  "quality": "Kalite",
  "opening temperature": "Açma sıcaklığı",
  "compressor id": "Kompresör kimliği",
  "compressor oil": "Kompresör yağı",
  "chemical properties": "Kimyasal özellikler",
  "spark position": "Ateşleme konumu",
  "hose length": "Hortum uzunluğu",
  "number of blades/vanes": "Kanat sayısı",
  "electrode gap": "Elektrot aralığı",
  "spring design": "Yay yapısı",
  "quantity unit": "Adet birimi",
  "housing material": "Gövde malzemesi",
  "connector type": "Konnektör tipi",
  "always compare old and new part": "Eski ve yeni parçayı mutlaka karşılaştırın",
  "chain pitch": "Zincir adımı",
  "oil fill quantity": "Yağ dolum miktarı",
  "water pump type": "Su pompası tipi",
  "seal material": "Keçe malzemesi",
  "section": "Kesit",
  "inner brake drum diameter": "Fren kampanası iç çapı",
  "article number of the recommended special tool": "Önerilen özel aletin ürün numarası",
  "pressure": "Basınç",
  "bolt head-/nut design": "Cıvata başı/somun yapısı",
  "spark plug": "Buji",
  "gasket inside diameter": "Conta iç çapı",
  "gasket outside diameter": "Conta dış çapı",
  "timing chain size": "Triger zinciri ölçüsü",
  "number of light functions": "Aydınlatma fonksiyonu sayısı",
  "alternator charging current": "Alternatör şarj akımı",
  "tooth pitch": "Diş adımı",
  "quantity per axle": "Aks başına adet",
  "component number": "Parça numarası",
  "valve type": "Supap tipi",
  "oxygen sensor": "Oksijen sensörü",
  "version with active carbon (art. no.)": "Aktif karbonlu versiyon (ürün no.)",
  "basic version (art. no.)": "Temel versiyon (ürün no.)",
  "highly efficient version with active carbon (art. no.)": "Yüksek verimli aktif karbonlu versiyon (ürün no.)",
  "belts": "Kayışlar",
  "cooling type": "Soğutma tipi",
  "seal ring diameter": "Conta halkası çapı",
  "brake type": "Fren tipi",
  "required quantity": "Gerekli adet",
  "installed thickness": "Montajlı kalınlık",
  "external toothing wheel side": "Dış dişli (tekerlek tarafı)",
  "external toothing differential side": "Dış dişli (diferansiyel tarafı)",
  "internal toothing wheel side": "İç dişli (tekerlek tarafı)",
  "clamp": "Kelepçe",
  "warranty": "Garanti",
  "fastening type": "Bağlantı tipi",
  "internal thread": "İç diş",
  "external thread": "Dış diş",
  "fuel mixture formation": "Yakıt karışımı oluşumu",
  "model year from": "Model yılı başlangıç",
  "model year to": "Model yılı bitiş",
  "number of circuits": "Devre sayısı",
  "plug type": "Fiş tipi",
  "heating/cooling": "Isıtma/soğutma",
  "number of bolts/screws": "Cıvata/vida sayısı",
  "fitting depth": "Montaj derinliği",
  "pipe diameter": "Boru çapı",
  "recommended additional repairs": "Önerilen ek onarımlar",
  "ignition coil": "Ateşleme bobini",
  "bypass valve opening pressure": "Bypass supabı açma basıncı",
  "glow plug design": "Kızdırma bujisi yapısı",
  "shape": "Şekil",
  "fitting time": "Montaj süresi",
  "axle joint length": "Aks mafsalı uzunluğu",
  "bearing type": "Rulman tipi",
  "mounting points diameter": "Bağlantı noktası çapı",
  "gross weight": "Brüt ağırlık",
  "notches/holes number": "Çentik/delik sayısı",
  "cylinder bore": "Silindir çapı",
  "flange diameter": "Flanş çapı",
  "brake lining": "Fren balatası",
  "number of wear indicators": "Aşınma göstergesi sayısı",
  "quality/ grade": "Kalite/sınıf",
  "stroke": "Strok",
  "extention force": "Açılma kuvveti",
  "multi-piece": "Çok parçalı",
  "number of layers": "Katman sayısı",
  "screw length below head": "Baş altı vida uzunluğu",
  "bolt head diameter": "Cıvata başı çapı",
  "impeller diameter": "Çark çapı",
  "swirl type": "Girdap tipi",
  "adjustment": "Ayar",
  "recommended change interval": "Önerilen değişim aralığı",
  "position/degree": "Konum/derece",
  "switch function": "Şalter fonksiyonu",
  "hub profile": "Poyra profili",
  "housing diameter": "Gövde çapı",
  "pump type": "Pompa tipi",
  "resistor": "Direnç",
  "alternative item": "Alternatif ürün",
  "radial shaft seal design": "Radyal mil keçesi yapısı",
  "dust cover": "Toz kapağı",
  "additionally required articles (article numbers)": "Ek olarak gereken ürünler (ürün numaraları)",
  "additionally required article (article number)": "Ek olarak gereken ürün (ürün numarası)",
  "min. length": "Minimum uzunluk",
  "max. length": "Maksimum uzunluk",
  "current strength": "Akım şiddeti",
  "cone pitch": "Konik adımı",
  "number of fan blades": "Fan kanadı sayısı",
  "total width": "Toplam genişlik",
  "clutch": "Debriyaj",
  "temperature range to": "Sıcaklık aralığı bitiş",
  "temperature range from": "Sıcaklık aralığı başlangıç",
  "depth": "Derinlik",
  "clutch pressure plate outer diameter": "Debriyaj baskı plakası dış çapı",
  "only for article number": "Yalnızca şu ürün numarası için",
  "tightening torque to": "Sıkma torku bitiş",
  "tightening torque from": "Sıkma torku başlangıç",
  "hole arrangement/number": "Delik düzeni/sayısı",
  "bolt length": "Cıvata uzunluğu",
  "compression height": "Sıkıştırma yüksekliği",
  "friction lining material": "Sürtünme balatası malzemesi",
  "housing length": "Gövde uzunluğu",
  "production number": "Üretim numarası",
  "width of castor bearing surface": "Teker yatak yüzeyi genişliği",
  "version": "Versiyon",
  "number of doors": "Kapı sayısı",
  "socket colour": "Duy rengi",
  "machined": "İşlenmiş",
  "pinion rest position": "Pinyon bekleme konumu",
  "power": "Güç",
  "mounting points distance bottom": "Bağlantı noktası mesafesi (alt)",
  "mounting points distance top": "Bağlantı noktası mesafesi (üst)",
  "mounting points distance right": "Bağlantı noktası mesafesi (sağ)",
  "mounting points distance left": "Bağlantı noktası mesafesi (sol)",
  "valve pocket depth": "Supap yuvası derinliği",
  "charge type": "Dolum tipi",
  "country specific design": "Ülkeye özel yapı",
  "recess depth": "Girinti derinliği",
  "recess diameter": "Girinti çapı",
  "belt width": "Kayış genişliği",
  "number of inlets/outlets": "Giriş/çıkış sayısı",
  "water pump pulley diameter": "Su pompası kasnak çapı",
  "piston protrusion to": "Piston çıkıntısı bitiş",
  "piston protrusion from": "Piston çıkıntısı başlangıç",
  "top land height": "Üst piston yüksekliği",
  "wheel-sided joint diameter": "Mafsal çapı (tekerlek tarafı)",
  "transmission-sided joint diameter": "Mafsal çapı (şanzıman tarafı)",
  "number of pads": "Balata sayısı",
  "alternator type": "Alternatör tipi",
  "exit thread size": "Çıkış diş ölçüsü",
  "piston clearance": "Piston boşluğu",
  "pressure from": "Basınç başlangıç",
  "rated voltage": "Anma gerilimi",
  "fmsi code": "FMSI kodu",
  "brake caliper type": "Fren kaliperi tipi",
  "distance to first groove": "İlk kanala mesafe",
  "number of threaded holes": "Dişli delik sayısı",
  "wheel bolt bore diameter": "Bijon deliği çapı",
  "joint type": "Mafsal tipi",
  "wheel fastening": "Tekerlek bağlantısı",
  "alternative repair kit": "Alternatif tamir takımı",
  "protection type": "Koruma tipi",
  "distance from belt pulley to alternator": "Kayış kasnağından alternatöre mesafe",
  "available as universal article as well, see article no.": "Universal ürün olarak da mevcut, ürün no.'ya bakın",
  "warning contact length": "Uyarı kontağı uzunluğu",
  "for housing diameter from": "Gövde çapı başlangıç",
  "for housing diameter up to": "Gövde çapı bitiş",
  "din/iso": "DIN/ISO",
};

const nouns: Record<string, string> = {
  "gaskets/seals": "conta/keçe", "gasket/seal": "conta/keçe", "seal ring": "conta halkası", "seal": "keçe",
  "ball joint": "rotil", "accessories": "aksesuar", "bulb holder": "ampul yuvası", "bulb": "ampul",
  "anti-squeak plate": "gıcırtı önleyici plaka", "bolts/screws": "cıvata/vida", "dryer": "kurutucu", "nut": "somun",
  "clutch release bearing": "debriyaj bilyası",
};

const values: Record<string, string> = {
  "premium": "Premium", "filter insert": "Filtre kartuşu", "ece approved": "ECE onaylı", "aluminium": "Alüminyum",
  "control arm": "Salıncak kolu", "no svhc present!": "SVHC madde yok", "electric": "Elektrikli", "black": "Siyah",
  "plastic": "Plastik", "twin-tube": "Çift borulu", "gas pressure": "Gaz basınçlı", "lower": "Alt", "upper": "Üst",
  "brazed cooling fins": "Lehimli soğutma kanatçıkları", "rubber-metal mount": "Kauçuk-metal takoz", "spin-on filter": "Vidalı filtre",
  "steel": "Çelik", "coupling rod": "Z rot", "top pin": "Üst pim", "in-line filter": "Hat tipi filtre", "sheet steel": "Sac",
  "clockwise rotation": "Saat yönünde dönüş", "counter-clockwise rotation": "Saat yönünün tersine dönüş", "for right-hand traffic": "Sağ trafik için",
  "for left-hand traffic": "Sol trafik için", "for left-hand drive vehicles": "Soldan direksiyonlu araçlar için",
  "for right-hand drive vehicles": "Sağdan direksiyonlu araçlar için", "suspension strut": "Amortisör (strut)",
  "telescopic shock absorber": "Teleskopik amortisör", "particulate filter": "Partikül filtresi", "activated carbon filter": "Aktif karbon filtre",
  "hydro mount": "Hidrolik takoz", "low-metallic": "Düşük metalik", "plastic radiator": "Plastik radyatör", "polyester": "Polyester",
  "elastomer": "Elastomer", "steel elastomer": "Çelik elastomer", "rubber/metal": "Kauçuk/metal", "both sides": "Her iki taraf",
  "oiled": "Yağlı", "painted": "Boyalı", "coated": "Kaplamalı", "vented": "Havalandırmalı", "ventilated": "Havalandırmalı",
  "with right-hand thread": "Sağ dişli", "with left-hand thread": "Sol dişli", "corrosion resistant": "Korozyona dayanıklı",
  "with acoustic wear warning": "Sesli aşınma uyarılı", "prepared for wear warning indicator": "Aşınma göstergesi için hazırlıklı",
  "prepared for wear indicator": "Aşınma göstergesi için hazırlıklı", "flat wiper blade": "Düz silecek", "led": "LED", "coil spring": "Helezon yay",
  "bottom eye": "Alt göz", "multilayer steel (mls)": "Çok katmanlı çelik (MLS)", "box": "Kutu", "easy fit": "Kolay montaj",
  "no information available. please contact the manufacturer!": "Bilgi yok, lütfen üreticiyle iletişime geçin",
  "in particular oe no.": "özellikle OE no.", "ethylene propylene diene monomer (m-class) rubber": "EPDM kauçuk",
  "epdm (ethylene propylene diene monomer (m-class) rubber)": "EPDM (etilen propilen dien monomer kauçuk)",
  "yes": "Evet", "no": "Hayır", "rubber": "Kauçuk", "cast iron": "Dökme demir", "copper": "Bakır", "brass": "Pirinç", "silicone": "Silikon",
  "ceramic": "Seramik", "textile": "Tekstil", "paper": "Kâğıt", "front": "Ön", "rear": "Arka", "left": "Sol", "right": "Sağ",
  "intake side": "Emme tarafı", "exhaust side": "Egzoz tarafı", "transmission sided": "Şanzıman tarafı", "transmission side": "Şanzıman tarafı",
  "wheel side": "Tekerlek tarafı", "frontal sided": "Ön tarafı", "engine sided": "Motor tarafı", "driver side": "Sürücü tarafı",
  "passenger side": "Yolcu tarafı", "eng.compart. passeng. side": "Motor bölmesi yolcu tarafı",
  "before catalytic converter": "Katalitik konvertör öncesi", "after catalytic converter": "Katalitik konvertör sonrası",
  "before soot particulate filter": "Partikül filtresi öncesi", "after soot particulate filter": "Partikül filtresi sonrası",
  "charge air cooler": "Intercooler (turbo hava soğutucusu)", "in fuel tank": "Yakıt deposunda", "in the fuel tank": "Yakıt deposunda",
  "behind the glove compartment": "Torpido arkası", "below the glove compartment": "Torpido altı", "cylinder head": "Silindir kapağı",
  "engine": "Motor", "lateral installation": "Yandan montaj", "bumper": "Tampon", "below the middle console": "Orta konsol altı",
  "exhaust manifold": "Egzoz manifoldu", "throttle housing": "Gaz kelebeği gövdesi", "inlet": "Giriş", "outlet": "Çıkış",
  "petrol": "Benzin", "diesel": "Dizel", "cng": "CNG", "cng/lpg": "CNG/LPG", "petrol/gas (bifuel)": "Benzin/Gaz (çift yakıt)",
  "oil pressure": "Yağ basınçlı", "monotube": "Tek borulu", "electronically adjustable shock strength": "Elektronik ayarlı sertlik",
  "pollen filter": "Polen filtresi", "screen filter": "Elekli filtre", "with antibacterial action": "Antibakteriyel etkili",
  "with fungicidal effect": "Mantar önleyici etkili", "with anti-allergic effect": "Antialerjik etkili", "with antiviral effect": "Antiviral etkili",
  "centrifuge": "Santrifüj", "pre-filter": "Ön filtre", "fresh air filter": "Temiz hava filtresi",
  "bolted": "Cıvatalı", "mounting": "Montaj", "rubber mount": "Kauçuk takoz", "screw connection": "Vidalı bağlantı", "plugged": "Geçmeli",
  "plug-in connection": "Geçme bağlantı", "pre-assembled": "Ön montajlı", "not pre-assembled": "Ön montajsız", "not pre-mounted": "Ön montajsız",
  "pressed": "Presli", "glued": "Yapıştırmalı",
  "manual transmission": "Manuel şanzıman", "automatic transmission": "Otomatik şanzıman", "dual-clutch transmission": "Çift kavramalı şanzıman",
  "cvt automatic transmission (stepless)": "CVT (kademesiz) otomatik şanzıman",
  "bracket wiper blade": "Klasik (kollu) silecek", "hybrid wiper blade": "Hibrit silecek",
  "bracket wiper blade without spoiler": "Klasik (kollu) silecek, spoilersiz", "bracket wiper blade with spoiler": "Klasik (kollu) silecek, spoilerli",
  "rear wiper blade in plastic design": "Plastik gövdeli arka silecek", "wiper blade with optical wear warning": "Optik aşınma uyarılı silecek",
  "long-life filter": "Uzun ömürlü filtre", "side stream filtration": "Yan akış filtrasyonu", "suction filter": "Emiş filtresi",
  "air recirculation filter": "Hava sirkülasyon filtresi", "flame-retardant filter medium": "Alev geciktirici filtre malzemesi",
  "particulate filter (pm 2.5)": "Partikül filtresi (PM 2.5)", "activated carbon filter with polyphenol": "Polifenollü aktif karbon filtre",
  "particle separation rate >98% for 2.5µm (fine matter)": "2,5 µm için %98 üzeri partikül tutma oranı (ince toz)",
  "with oil separation function": "Yağ ayırma işlevli", "with water separator": "Su ayırıcılı", "without water separator": "Su ayırıcısız",
  "with connection for water sensor": "Su sensörü bağlantılı", "without connection for water sensor": "Su sensörü bağlantısız",
  "with sealing cap": "Sızdırmazlık kapaklı", "with quick coupling": "Hızlı bağlantılı", "with filter heating": "Filtre ısıtmalı",
  "without filter heating": "Filtre ısıtmasız", "with water drain screw": "Su boşaltma vidalı",
  "hard version": "Sert tip", "soft version": "Yumuşak tip",
  "air filter housing": "Hava filtresi gövdesi", "intake manifold": "Emme manifoldu", "air filter to the intake manifold": "Hava filtresinden emme manifolduna",
  "mass air flow sensor to throttle body": "Hava akış sensöründen gaz kelebeğine", "below plenum chamber cover": "Emme haznesi kapağı altı",
  "high pressure pump (low pressure side)": "Yüksek basınç pompası (alçak basınç tarafı)", "behind exhaust turbocharger": "Egzoz turbosu arkası",
  "before exhaust turbocharger": "Egzoz turbosu öncesi", "fuel line": "Yakıt hattı", "ignition coil": "Ateşleme bobini",
  "electrically adjustable hydro mount": "Elektrikle ayarlı hidrolik takoz", "pipe-neck": "Boru boyunlu", "hydro bearing": "Hidrolik yatak",
  "rubber-metal bearing": "Kauçuk-metal yatak", "fitting": "Takma", "clipped": "Klipsli", "clamped": "Kelepçeli", "bayonet": "Bayonet",
};

const gearboxKinds: Record<string, string> = { manual: "manuel şanzıman", automatic: "otomatik şanzıman", "dual-clutch": "çift kavramalı şanzıman" };

/** Position words of "Right Front", "Lower Front Axle"..., longest phrase first so "front axle" wins over "front". */
const positionWords: [string, string][] = [
  ["front axle", "ön aks"], ["rear axle", "arka aks"], ["both sides", "her iki taraf"], ["front", "ön"], ["rear", "arka"],
  ["left", "sol"], ["right", "sağ"], ["upper", "üst"], ["top", "üst"], ["lower", "alt"], ["bottom", "alt"], ["inner", "iç"],
  ["outer", "dış"], ["centre", "orta"], ["center", "orta"], ["middle", "orta"], ["and", "ve"],
];

/** Turkish for a position written word by word ("Lower Front Axle" is "Alt ön aks"); null unless every word is known. */
function composePosition(part: string) {
  let rest = part.trim().toLowerCase().replace(/\s+/g, " ");
  const out: string[] = [];
  while (rest) {
    const hit = positionWords.find(([word]) => rest === word || rest.startsWith(`${word} `));
    if (!hit) return null;
    out.push(hit[1]);
    rest = rest.slice(hit[0].length).trim();
  }
  if (!out.length || out.every(word => word === "ve")) return null;
  const text = out.join(" ");
  return text.charAt(0).toLocaleUpperCase("tr") + text.slice(1);
}

const unitAndIndex = /^(.*?)(?:\s+(\d+))?(\s*\[[^\]]*\])?$/;

/** Turkish label of an enrichment specification key; keys without a translation stay as written. */
export function translateSpecificationLabel(key: string) {
  const exact = specificationLabel(key);
  if (exact !== key) return exact;
  const [, base = key, index, unit] = key.trim().match(unitAndIndex) ?? [];
  const label = Object.hasOwn(labels, base.trim().toLowerCase()) ? labels[base.trim().toLowerCase()] : null;
  return label ? `${label}${index ? ` ${index}` : ""}${unit ?? ""}` : key;
}

/** Turkish text of an enrichment specification value; "with/without ..." phrases name their noun in Turkish, unknown text stays as written. */
export function translateSpecificationValue(value: string) {
  const exact = specificationValue(value);
  if (exact !== value) return exact;
  const lower = value.trim().toLowerCase();
  if (Object.hasOwn(values, lower)) return values[lower];
  const gearbox = lower.match(/^(\d+)-speed (manual|automatic|dual-clutch) transmission$/);
  if (gearbox) return `${gearbox[1]} ileri ${gearboxKinds[gearbox[2]]}`;
  const discharge = value.trim().match(/^(\S+) \(gas discharge (?:lamp|tube)\)$/i);
  if (discharge) return `${discharge[1]} (xenon)`;
  const phrase = lower.match(/^(with|without) (.+)$/);
  if (!phrase) return value;
  const names = phrase[2].split(/,\s*(?:without |with )?/);
  if (!names.every(name => Object.hasOwn(nouns, name))) return value;
  const items = names.map(name => nouns[name]);
  return `${items.join(", ")} ${phrase[1] === "with" ? "dahil" : "hariç"}`;
}

/** A list comma: not the decimal comma of "1,5" or "M14 x 1,5". */
const listComma = /(?<!\d),|,(?!\d)/;

/** Each comma separated part translated on its own; a part stays as written unless the dictionary or the position words know all of it. */
export function translateSpecificationParts(value: string) {
  const parts = value.split(listComma).map(part => part.trim()).filter(Boolean).map(part => {
    const translated = translateSpecificationValue(part);
    return translated !== part ? translated : composePosition(part) ?? part;
  });
  return parts;
}

/** Turkish text of a (possibly comma separated) specification value: the whole text first, otherwise part by part. */
export function translateSpecificationList(value: string) {
  const whole = translateSpecificationValue(value);
  if (whole !== value) return whole;
  const parts = translateSpecificationParts(value);
  const original = value.split(listComma).map(part => part.trim()).filter(Boolean);
  return parts.length === original.length && parts.every((part, index) => part === original[index]) ? value : parts.join(", ");
}

const keyOf = (text: string) => /^[\x00-\x7f]*$/.test(text) ? text.toLowerCase() : text.toLocaleLowerCase("tr");

/**
 * The sidebar options of one facet: raw values that translate to the same set of parts (order, case and repeats
 * ignored) become one option that lists every raw value, so the URL keeps the raw spellings the filter matches.
 */
export function facetOptions(rawValues: string[]) {
  const groups = new Map<string, { label: string; values: string[] }>();
  for (const raw of rawValues) {
    const parts = translateSpecificationParts(raw);
    const key = [...new Set(parts.map(keyOf))].sort().join("|");
    const group = groups.get(key);
    if (group) group.values.push(raw);
    else groups.set(key, { label: [...new Map(parts.map(part => [keyOf(part), part])).values()].join(", ") || raw, values: [raw] });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/** The card's display pairs, same order as the raw pairs: Turkish label and value, while the raw pairs stay the keys of compare and filters. */
export function displaySpecifications(specifications: [string, string][]): [string, string][] {
  return specifications.map(([key, value]) => [translateSpecificationLabel(key), translateSpecificationList(value)]);
}
