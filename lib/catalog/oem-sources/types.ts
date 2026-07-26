/**
 * Web kaynaklarından OEM çapraz referansı çekmek için ortak sözleşme.
 *
 * Her kaynak "marka + parça numarası" alır, o parçanın OEM numaralarını döner.
 * Kaynaklar tek tek eklenir çünkü tüm katalogu kapsayan tek bir açık kaynak yok:
 * üreticilerin kendi katalogları en güvenilir veriyi verir ama yalnız kendi
 * markalarını kapsar.
 */

export interface SourcedOem {
  /** Araç markası (kaynağın yazdığı biçimde); kaynak vermiyorsa null. */
  brand: string | null
  /** OEM numarası, kaynaktaki biçimiyle. */
  code: string
}

export interface OemLookup {
  /**
   * Kaynakta parçanın KENDİSİ bulundu mu (numara birebir eşleşti mi).
   * Arama uçları benzer ürünleri de döndürdüğü için bu ayrım şart:
   * eşleşmeyen sonuçların OEM'leri başka bir parçaya aittir.
   */
  matched: boolean
  oems: SourcedOem[]
  /** Kaynakta ürünün adı/tanımı (varsa) — kanıt metnine girer. */
  description: string | null
  /** İnsanın doğrulayabileceği kaynak adresi. */
  sourceUrl: string
}

export interface OemSource {
  /** Öneri kaydına yazılacak kaynak kimliği (alan adı). */
  readonly site: string
  /**
   * Kaynak, parçayı üreten firmanın kendi kataloğu mu?
   *
   * Öneri güveni buna bakar: resmi katalog HIGH'a çıkabilir, çıkarımsal
   * kaynaklar (web araması, perakende sitesi) çıkamaz — doğru olabilirler ama
   * doğrulukları kanıtlanmış değildir, incelemeci bunu bilerek bakmalı.
   */
  readonly authoritative: boolean
  /** Bu kaynak katalogdaki bu markayı kapsıyor mu. */
  supports(brand: string): boolean
  /** Kapsanan markalar — sürücü hedef seçiminde kullanır. Boş = marka bağımsız. */
  brands(): string[]
  /** productName kaynağa bağlam verir (bazı kaynaklar kullanır, bazıları yok sayar). */
  lookup(brand: string, partNo: string, productName?: string): Promise<OemLookup>
}
