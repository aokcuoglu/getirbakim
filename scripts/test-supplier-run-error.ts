import assert from "node:assert/strict";
import { test } from "node:test";
import { supplierRunError } from "../src/modules/admin/supplier-run-error";

test("quality rejections and interrupted runs read the same for every supplier", () => {
  assert.equal(supplierRunError("product-drop-over-20-percent"), "Ürün sayısı %20’den fazla azaldı; inceleme gerekli");
  assert.equal(supplierRunError("missing-stocks-increased-over-10-points", "dinamik"), "Eksik stok oranı 10 puandan fazla arttı; inceleme gerekli");
  assert.equal(supplierRunError("missing-prices-increased-over-10-points", "seta"), "Eksik fiyat oranı 10 puandan fazla arttı; inceleme gerekli");
  assert.equal(supplierRunError("empty-products"), "Kaynak boş ürün listesi döndürdü; inceleme gerekli");
  assert.equal(supplierRunError("worker-interrupted", "basbug"), "İşlem tamamlanmadan kesildi");
});

test("upstream failures name the service and the HTTP status", () => {
  assert.equal(supplierRunError("upstream: FiyatGetir", "basbug"), "Fiyat: veri alınamadı");
  assert.equal(supplierRunError("upstream: ListeGrubuGetir: timeout", "basbug"), "Grup listesi: yanıt zaman aşımına uğradı");
  assert.equal(supplierRunError("upstream: Auth: HTTP 605", "basbug"), "Oturum açma: Başbuğ hata döndürdü (HTTP 605)");
  assert.equal(supplierRunError("upstream: products: HTTP 502", "seta"), "Ürün listesi: SETA hata döndürdü (HTTP 502)");
  assert.equal(supplierRunError("upstream: DB"), "Veriler kaydedilemedi; önceki veriler korundu");
});

test("Dinamik's HTTP 500 is its server-side timeout and 401/403 its IP allow-list", () => {
  assert.equal(supplierRunError("upstream: getStockList: HTTP 500", "dinamik"), "Stok listesi: Dinamik sunucu hatası (HTTP 500, çoğunlukla zaman aşımı)");
  assert.equal(supplierRunError("upstream: getStockList: HTTP 401", "dinamik"), "Stok listesi: Dinamik bu sunucunun IP adresine izin vermiyor (HTTP 401)");
  assert.equal(supplierRunError("upstream: getPriceList: HTTP 403", "dinamik"), "Fiyat listesi: Dinamik bu sunucunun IP adresine izin vermiyor (HTTP 403)");
  assert.equal(supplierRunError("upstream: getStockList: timeout", "dinamik"), "Stok listesi: yanıt zaman aşımına uğradı");
});

test("setup errors and unknown codes never surface the raw code", () => {
  assert.equal(supplierRunError("config: Config"), "Bağlantı ayarları eksik veya geçersiz");
  assert.equal(supplierRunError("contract: Contract", "dinamik"), "Yanıt veri yapısı doğrulanamadı");
  assert.equal(supplierRunError("busy"), "Başka bir çekim sürüyordu; bu deneme başlatılmadı");
  assert.equal(supplierRunError("something-new: x"), "Servis veya kayıt işlemi tamamlanamadı");
});
