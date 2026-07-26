/**
 * Kaynakların yazdığı araç markası adını katalogun kendi sözlüğüne çevirir.
 *
 * Neden gerekli: catalog.product_oems'in benzersiz anahtarı
 * (product_id, code_norm, oem_brand) marka adını da içeriyor. Kaynak "Citroën"
 * yerine "CITROEN", "VW" yerine "Volkswagen (VW)" yazarsa aynı OEM ikinci kez
 * eklenir ve tekilleştirme sessizce bozulur. Bu yüzden yeni marka adı
 * uydurmak yerine DB'de HÂLİHAZIRDA kullanılan değere bağlanır.
 */

/** Karşılaştırma anahtarı: aksan ve ayraçlardan arındırılmış büyük harf. */
export function vocabKey(value: string): string {
  // NFKD aksanı ayrı bir birleşen karaktere böler ("Ë" → "E" + U+0308); son
  // filtre A-Z0-9 dışını attığı için birleşen işaret ayrıca temizlenmez.
  return value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Sözlükten çözümleyici üretir.
 *
 * Sıra önemlidir:
 *   1. birebir eşleşme                     ("Mercedes-Benz" → MERCEDES-BENZ)
 *   2. parantezli sonek atılarak           ("IVECO (LCV)" → IVECO)
 *   3. parantez İÇİ                        ("Volkswagen (VW)" → VW)
 *
 * 2 ve 3'ün sırası ters olamaz: parantez içi çoğu kez ÜST markayı ya da ortak
 * girişimi gösterir, markanın kendisini değil — "Alpina (BMW)" BMW değildir,
 * "RAM (Chrysler)" Chrysler değildir. Gövde tutmadığında parantez içi tek
 * kalan ipucudur ve orada doğrudur ("KGM (SsangYong)" → SSANGYONG).
 *
 * Hiçbiri tutmazsa ham ad büyük harfe çevrilip yazılır: sözlükte olmayan
 * (çoğu Çin/bölge varyantı) markayı atmak, kanıtlanmış OEM'i kaybetmek olurdu.
 */
export function createBrandResolver(vocabulary: Iterable<string>): (raw: string) => string {
  const byKey = new Map<string, string>()
  for (const entry of vocabulary) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue
    const key = vocabKey(trimmed)
    if (key.length > 0 && !byKey.has(key)) byKey.set(key, trimmed)
  }

  return (raw: string): string => {
    const value = raw.trim()
    if (value.length === 0) return ''

    const exact = byKey.get(vocabKey(value))
    if (exact) return exact

    const body = value.replace(/\s*\([^)]*\)/g, '').trim()
    if (body.length > 0 && body !== value) {
      const hit = byKey.get(vocabKey(body))
      if (hit) return hit
    }

    const inner = value.match(/\(([^)]*)\)/)?.[1]?.trim()
    if (inner && inner.length > 0) {
      const hit = byKey.get(vocabKey(inner))
      if (hit) return hit
    }

    return value.toUpperCase()
  }
}
