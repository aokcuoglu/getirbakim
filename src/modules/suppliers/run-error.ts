/**
 * The one Turkish text for a supplier import's stored `error_reason` (supplier_imports), used by the supplier pages'
 * run history and by the supplier overview (data-status.ts importErrorLabel). Reasons are written by the Başbuğ,
 * Dinamik and SETA importers as either a quality rejection code (`product-drop-over-20-percent`) or
 * `<kind>: <stage>[: <diagnostic>]` (`upstream: getStockList: HTTP 500`).
 */
export type SupplierRunErrorSource = "basbug" | "dinamik" | "seta";

const sourceNames: Record<SupplierRunErrorSource, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };

// A rejected import keeps the previous data on the shelf.
const kept = "kalite kontrolü önceki veriyi korudu";
const rejections: Record<string, string> = {
  "empty-products": `Kaynak boş ürün listesi döndürdü; ${kept}`,
  "product-drop-over-20-percent": `Ürün listesi önceki çekime göre %20’den fazla küçüldü; ${kept}`,
  "missing-prices-increased-over-10-points": `Eksik fiyat oranı 10 puandan fazla arttı; ${kept}`,
  "missing-stocks-increased-over-10-points": `Eksik stok oranı 10 puandan fazla arttı; ${kept}`,
  "worker-interrupted": "Çekim yarıda kesildi",
  "operator-paused": "Çekimler elle durduruldu",
};

// Importer stages (the API call or step that failed) → service name shown to the admin.
const stages: Record<string, string> = {
  Auth: "Oturum açma", ListeGrubuGetir: "Grup listesi", MalzemeleriGetir: "Ürün listesi", FiyatGetir: "Fiyat", StokGetir: "Stok", DovizBilgisiGetir: "Kur",
  getBrandList: "Marka listesi", getStockList: "Stok listesi", getPriceList: "Fiyat listesi", getStock: "Stok sorgusu",
  products: "Ürün listesi",
};

export function supplierRunError(reason: string, source?: SupplierRunErrorSource) {
  const text = reason.trim();
  if (rejections[text]) return rejections[text];
  const [kind, stage = "", ...rest] = text.split(":").map(part => part.trim());
  const detail = rest.join(":");
  if (kind === "busy") return "Başka bir çekim sürüyordu; bu deneme başlatılmadı";
  if (kind === "paused") return "Çekimler elle durduruldu";
  if (kind === "config") return "Bağlantı ayarları eksik veya geçersiz";
  if (kind === "contract") return "Yanıt beklenen biçimde değil";
  if (kind === "rejected") return `Veri kalite kontrolünden geçemedi; ${kept}`;
  if (kind === "upstream") {
    if (stage === "DB") return "Veriler kaydedilemedi; önceki veriler korundu";
    const service = stages[stage] ?? (stage === "Bağlantı" || stage === "Config" ? "Bağlantı" : "Servis");
    const status = detail.match(/HTTP (\d{3})/)?.[1];
    const name = source ? sourceNames[source] : "Tedarikçi";
    if (/^(timeout|ETIMEDOUT|ECONNRESET)/.test(detail)) return `${service}: tedarikçiye bağlanılamadı (zaman aşımı)`;
    // Dinamik answers 401/403 to hosts outside its IP allow-list.
    if (status === "401" || status === "403") return `${service}: ${name} erişimi reddetti (HTTP ${status}; IP izni veya anahtar)`;
    // Dinamik's large stock lists fail server side with "The wait operation timed out", reported as HTTP 500.
    if (status === "500" && source === "dinamik") return `${service}: Dinamik sunucusu hata verdi (HTTP 500, çoğunlukla zaman aşımı)`;
    if (status?.startsWith("5")) return `${service}: ${name} sunucusu hata verdi (HTTP ${status})`;
    if (status) return `${service}: ${name} hata döndürdü (HTTP ${status})`;
    if (stage === "Auth") return "Tedarikçi oturumu açılamadı";
    return `${service}: tedarikçiden veri alınamadı`;
  }
  return "Servis veya kayıt işlemi tamamlanamadı";
}
