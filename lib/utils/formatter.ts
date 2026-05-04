// Types based on your Prisma Schema structure
type VehicleTypeData = {
  id: number
  year_of_constr_from: string | null // Genelde YYYYMM formatında olur
  year_of_constr_to: string | null
  vehicle_models: {
    id: number
    name: string // Örn: "GOLF VII (5G1, BQ1, BE1, BE2)"
    // Marka adı modelin içinde gelmiyorsa ayrıca eklenmeli
  }
}

/**
 * Ham araç listesini alır ve model bazlı yıl aralıklarıyla özetler.
 * Çıktı Örneği: ["Volkswagen GOLF VII (2012-2020)", "Audi A3 (2012-Sent)"]
 */
export function formatCompatibility(vehicleTypes: VehicleTypeData[]): string[] {
  const groups = new Map<
    number,
    {
      name: string
      minDate: string
      maxDate: string
      hasOpenEnd: boolean
    }
  >()

  for (const v of vehicleTypes) {
    const modelId = v.vehicle_models.id
    const modelName = v.vehicle_models.name

    // Veritabanındaki tarih formatı '201205' (YYYYMM) gibiyse sadece yılı alıyoruz
    // Eğer format farklıysa burayı parse edecek basit bir helper gerekebilir.
    const fromDate = v.year_of_constr_from
      ? v.year_of_constr_from.substring(0, 4)
      : '????'
    const toDate = v.year_of_constr_to
      ? v.year_of_constr_to.substring(0, 4)
      : null

    if (!groups.has(modelId)) {
      groups.set(modelId, {
        name: modelName,
        minDate: fromDate,
        maxDate: toDate || fromDate, // Başlangıçta maxDate yoksa min'e eşitle
        hasOpenEnd: toDate === null // Bitiş tarihi yoksa üretim devam ediyordur
      })
    } else {
      const group = groups.get(modelId)!

      // En eski tarihi bul
      if (fromDate < group.minDate && fromDate !== '????') {
        group.minDate = fromDate
      }

      // En yeni tarihi bul
      if (toDate === null) {
        group.hasOpenEnd = true
      } else if (toDate > group.maxDate) {
        group.maxDate = toDate
      }
    }
  }

  // Map'i string array'e çevir
  return Array.from(groups.values()).map((g) => {
    const yearRange = g.hasOpenEnd
      ? `(${g.minDate}-...)` // Veya "Günümüz"
      : `(${g.minDate}-${g.maxDate})`

    // Örn: "GOLF VII (2012-2017)"
    return `${g.name} ${yearRange}`
  })
}
