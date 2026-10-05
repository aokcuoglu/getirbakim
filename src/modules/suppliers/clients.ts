import "server-only";
import type { SupplierStatus } from "./contracts";
export function supplierStatuses(): SupplierStatus[] {
 return [
 { name: "Dinamik", configured: ["DINAMIK_BASE","DINAMIK_APIKEY","DINAMIK_SECRETKEY"].every(k => Boolean(process.env[k])), verified: false, message: "Dokümantasyon isteği 401: mevcut IP adresine erişim izni yok. Ürün sözleşmesi ve canlı yanıt doğrulanmalı." },
 { name: "Başbuğ", configured: ["BASBUG_BASE_URL","BASBUG_USERNAME","BASBUG_PASSWORD","BASBUG_CLIENT_ID","BASBUG_CLIENT_SECRET"].every(k => Boolean(process.env[k])), verified: false, message: "Auth ve ürün/fiyat/stok okuma çağrıları canlı doğrulandı. NF maliyet üzerinden TRY satış fiyatı hesaplanıyor. Stok bulunabilirlik sinyali olarak kullanılıyor." },
 ];
}
// Fail closed until the actual wire contracts and read-only endpoints are verified.
// No guessed authentication, paths, price mappings, or synthetic supplier responses.
export async function searchSupplierProducts(supplier: "dinamik" | "basbug", code: string): Promise<never> {
 if (!code.trim()) throw new Error("Ürün kodu gerekli.");
 throw new Error(`${supplier}: servis sözleşmesi henüz doğrulanmadı.`);
}
