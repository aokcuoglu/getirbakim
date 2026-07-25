/**
 * Serbest metinden (ürün adı, web başlığı) araç markası çıkarımı ve OEM
 * paylaşan marka aileleri.
 *
 * Neden gerekli: OEM çapraz referansı bir araç markasına aittir
 * (catalog.product_oems.oem_brand) ama elimizdeki metinler markayı çoğu kez
 * yazmaz — model adı geçer ("ASTRA G / H VECTRA C"). Bir OEM önerisinin ürünün
 * kendi araç bilgisiyle çelişip çelişmediğini anlamak için iki tarafta da aynı
 * çıkarımı uygulamak gerekir.
 */

/** Metinde doğrudan geçebilen araç markaları. */
const VEHICLE_MAKERS = [
  'ALFA ROMEO',
  'MERCEDES-BENZ',
  'MERCEDES',
  'LAND ROVER',
  'RANGE ROVER',
  'VOLKSWAGEN',
  'CITROEN',
  'PEUGEOT',
  'RENAULT',
  'DACIA',
  'FIAT',
  'LANCIA',
  'ABARTH',
  'OPEL',
  'FORD',
  'BMW',
  'AUDI',
  'SEAT',
  'SKODA',
  'VOLVO',
  'SCANIA',
  'DAF',
  'MAN',
  'IVECO',
  'HYUNDAI',
  'KIA',
  'TOYOTA',
  'HONDA',
  'NISSAN',
  'MAZDA',
  'SUZUKI',
  'MITSUBISHI',
  'CHEVROLET',
  'DODGE',
  'JEEP',
  'CHRYSLER',
  'ISUZU',
  'JOHN DEERE',
  'MINI',
  'PORSCHE',
  'SSANGYONG',
  'SUBARU',
  'TATA',
  'TOFAS',
  'CUMMINS',
  'DEUTZ',
  'PERKINS'
]

/** Model adı → marka. Tedarikçi adları markayı yazmadığı için gerekli. */
const MODEL_TO_MAKER: Record<string, string> = {
  UNO: 'FIAT',
  BRAVA: 'FIAT',
  BRAVO: 'FIAT',
  DOBLO: 'FIAT',
  PALIO: 'FIAT',
  ALBEA: 'FIAT',
  PUNTO: 'FIAT',
  LINEA: 'FIAT',
  MAREA: 'FIAT',
  TEMPRA: 'FIAT',
  TIPO: 'FIAT',
  DUCATO: 'FIAT',
  FIORINO: 'FIAT',
  EGEA: 'FIAT',
  CROMA: 'FIAT',
  IDEA: 'FIAT',
  PANDA: 'FIAT',
  SCUDO: 'FIAT',
  CLIO: 'RENAULT',
  KANGOO: 'RENAULT',
  MEGANE: 'RENAULT',
  SYMBOL: 'RENAULT',
  LAGUNA: 'RENAULT',
  SCENIC: 'RENAULT',
  TRAFIC: 'RENAULT',
  MASTER: 'RENAULT',
  FLUENCE: 'RENAULT',
  SAFRANE: 'RENAULT',
  DUSTER: 'DACIA',
  LOGAN: 'DACIA',
  SANDERO: 'DACIA',
  ASTRA: 'OPEL',
  VECTRA: 'OPEL',
  CORSA: 'OPEL',
  ZAFIRA: 'OPEL',
  COMBO: 'OPEL',
  INSIGNIA: 'OPEL',
  MERIVA: 'OPEL',
  TRANSIT: 'FORD',
  FIESTA: 'FORD',
  FOCUS: 'FORD',
  MONDEO: 'FORD',
  CONNECT: 'FORD',
  ESCORT: 'FORD',
  COURIER: 'FORD',
  GOLF: 'VOLKSWAGEN',
  PASSAT: 'VOLKSWAGEN',
  POLO: 'VOLKSWAGEN',
  JETTA: 'VOLKSWAGEN',
  TOURAN: 'VOLKSWAGEN',
  CADDY: 'VOLKSWAGEN',
  TIGUAN: 'VOLKSWAGEN',
  TOUAREG: 'VOLKSWAGEN',
  PHAETON: 'VOLKSWAGEN',
  ACCENT: 'HYUNDAI',
  GETZ: 'HYUNDAI',
  TUCSON: 'HYUNDAI',
  SANTAFE: 'HYUNDAI',
  GRANDEUR: 'HYUNDAI',
  SPORTAGE: 'KIA',
  CHEROKEE: 'JEEP',
  ACTROS: 'MERCEDES-BENZ',
  AXOR: 'MERCEDES-BENZ',
  AROCS: 'MERCEDES-BENZ',
  ANTOS: 'MERCEDES-BENZ',
  SPRINTER: 'MERCEDES-BENZ',
  VITO: 'MERCEDES-BENZ',
  PARTNER: 'PEUGEOT',
  EXPERT: 'PEUGEOT',
  BERLINGO: 'CITROEN',
  JUMPER: 'CITROEN',
  JUMPY: 'CITROEN',
  XSARA: 'CITROEN',
  LANOS: 'CHEVROLET',
  SAMARA: 'LADA'
}

/**
 * OEM kodu paylaşan marka aileleri. Tek bir orijinal numara grup içindeki tüm
 * markalarda geçerlidir (55284051 → FIAT / ALFA ROMEO / LANCIA / ABARTH), bu
 * yüzden aynı ailedeki farklı bir marka çelişki sayılmaz.
 */
export const MAKER_FAMILIES: string[][] = [
  ['FIAT', 'ALFA ROMEO', 'LANCIA', 'ABARTH', 'IVECO'],
  ['PEUGEOT', 'CITROEN', 'DS'],
  ['VOLKSWAGEN', 'AUDI', 'SEAT', 'SKODA', 'PORSCHE'],
  ['RENAULT', 'DACIA', 'NISSAN'],
  ['HYUNDAI', 'KIA'],
  ['OPEL', 'CHEVROLET', 'SAAB'],
  ['FORD', 'VOLVO', 'MAZDA'],
  ['MERCEDES-BENZ', 'SSANGYONG'],
  ['BMW', 'MINI'],
  ['JEEP', 'DODGE', 'CHRYSLER']
]

/** Kelime sınırıyla arar: "RULMAN" içindeki "MAN" marka sayılmamalı. */
function hasWord(haystackUpper: string, needle: string): boolean {
  const pattern = needle.replace(/-/g, '[-\\s]')
  return new RegExp(`(?<![0-9A-ZÇĞİÖŞÜ])${pattern}(?![0-9A-ZÇĞİÖŞÜ])`).test(haystackUpper)
}

/**
 * Metinde geçen TÜM araç markalarını döndürür (marka adı ya da model adı
 * üzerinden). Bir ad birden çok markaya değinebilir: "ALFA ROMEO 156 FIAT
 * BRAVA" hem ALFA ROMEO hem FIAT'tır.
 */
export function inferVehicleMakers(text: string): string[] {
  const upper = text.toUpperCase()
  const out = new Set<string>()
  for (const maker of VEHICLE_MAKERS) {
    if (hasWord(upper, maker)) out.add(maker === 'MERCEDES' ? 'MERCEDES-BENZ' : maker)
  }
  for (const [model, maker] of Object.entries(MODEL_TO_MAKER)) {
    if (hasWord(upper, model)) out.add(maker)
  }
  return [...out]
}

/** İlk (en olası) araç markası; bulunamazsa null. */
export function inferVehicleMaker(text: string): string | null {
  return inferVehicleMakers(text)[0] ?? null
}

/** İki marka aynı OEM ailesinden mi (aynı numara ikisinde de geçerli mi)? */
export function sameMakerFamily(a: string, b: string): boolean {
  if (a === b) return true
  return MAKER_FAMILIES.some((family) => family.includes(a) && family.includes(b))
}
