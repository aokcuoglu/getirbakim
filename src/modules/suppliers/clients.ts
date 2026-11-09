import "server-only";
import type { SupplierStatus } from "./contracts";
export function supplierStatuses(): SupplierStatus[] {
 return [
 { name: "Dinamik", href: "/yonetim/tedarikciler/dinamik", configured: ["DINAMIK_BASE","DINAMIK_APIKEY","DINAMIK_SECRETKEY"].every(k => Boolean(process.env[k])), verified: true, message: "Marka listesi, marka bazlı stok ve fiyat listeleri sunucu IP izniyle (VPS) canlı doğrulandı ve her gece çekiliyor. Fiyat KDV hariç maliyet kabul edilir; satış fiyatı ortak kâr + KDV ile hesaplanır, herhangi bir bölgede VAR olan ürün satışa uygundur." },
 { name: "Başbuğ", href: "/yonetim/tedarikciler/basbug", configured: ["BASBUG_BASE_URL","BASBUG_USERNAME","BASBUG_PASSWORD","BASBUG_CLIENT_ID","BASBUG_CLIENT_SECRET"].every(k => Boolean(process.env[k])), verified: false, message: "Auth ve ürün/fiyat/stok okuma çağrıları canlı doğrulandı. NF maliyet üzerinden TRY satış fiyatı hesaplanıyor. Stok bulunabilirlik sinyali olarak kullanılıyor." },
 { name: "SETA", href: "/yonetim/tedarikciler/seta", configured: Boolean(process.env.SETA_API_KEY), verified: Boolean(process.env.SETA_API_KEY), message: "Tek uç noktadan tam liste canlı doğrulandı (ürün, OEM, çapraz referans, KDV hariç bayi fiyatı, stok var/yok). Satış fiyatı maliyet + kâr + KDV ile hesaplanıyor." },
 ];
}
// Fail closed until the actual wire contracts and read-only endpoints are verified.
// No guessed authentication, paths, price mappings, or synthetic supplier responses.
export async function searchSupplierProducts(supplier: "dinamik" | "basbug" | "seta", code: string): Promise<never> {
 if (!code.trim()) throw new Error("Ürün kodu gerekli.");
 throw new Error(`${supplier}: servis sözleşmesi henüz doğrulanmadı.`);
}
