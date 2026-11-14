import assert from "node:assert/strict";
import { test } from "node:test";
import { supplierRunError } from "../src/modules/suppliers/run-error";
import { importErrorLabel } from "../src/modules/suppliers/data-status";

test("quality rejections and interrupted runs read the same for every supplier", () => {
  assert.equal(supplierRunError("product-drop-over-20-percent"), "Ürün listesi önceki çekime göre %20’den fazla küçüldü; kalite kontrolü önceki veriyi korudu");
  assert.equal(supplierRunError("missing-stocks-increased-over-10-points", "dinamik"), "Eksik stok oranı 10 puandan fazla arttı; kalite kontrolü önceki veriyi korudu");
  assert.equal(supplierRunError("missing-prices-increased-over-10-points", "seta"), "Eksik fiyat oranı 10 puandan fazla arttı; kalite kontrolü önceki veriyi korudu");
  assert.equal(supplierRunError("empty-products"), "Kaynak boş ürün listesi döndürdü; kalite kontrolü önceki veriyi korudu");
  assert.equal(supplierRunError("worker-interrupted", "basbug"), "Çekim yarıda kesildi");
});

test("upstream failures name the service and the HTTP status", () => {
  assert.equal(supplierRunError("upstream: FiyatGetir", "basbug"), "Fiyat: tedarikçiden veri alınamadı");
  assert.equal(supplierRunError("upstream: ListeGrubuGetir: timeout", "basbug"), "Grup listesi: tedarikçiye bağlanılamadı (zaman aşımı)");
  assert.equal(supplierRunError("upstream: Auth", "basbug"), "Tedarikçi oturumu açılamadı");
  assert.equal(supplierRunError("upstream: Auth: HTTP 605", "basbug"), "Oturum açma: Başbuğ hata döndürdü (HTTP 605)");
  assert.equal(supplierRunError("upstream: products: HTTP 502", "seta"), "Ürün listesi: SETA sunucusu hata verdi (HTTP 502)");
  assert.equal(supplierRunError("upstream: DB"), "Veriler kaydedilemedi; önceki veriler korundu");
});

test("Dinamik's HTTP 500 is mostly its server-side timeout and 401/403 its IP allow-list", () => {
  assert.equal(supplierRunError("upstream: getStockList: HTTP 500", "dinamik"), "Stok listesi: Dinamik sunucusu hata verdi (HTTP 500, çoğunlukla zaman aşımı)");
  assert.equal(supplierRunError("upstream: getStockList: HTTP 401", "dinamik"), "Stok listesi: Dinamik erişimi reddetti (HTTP 401; IP izni veya anahtar)");
  assert.equal(supplierRunError("upstream: getPriceList: HTTP 403", "dinamik"), "Fiyat listesi: Dinamik erişimi reddetti (HTTP 403; IP izni veya anahtar)");
  assert.equal(supplierRunError("upstream: getStockList: timeout", "dinamik"), "Stok listesi: tedarikçiye bağlanılamadı (zaman aşımı)");
});

test("setup errors and unknown codes never surface the raw code", () => {
  assert.equal(supplierRunError("config: Config"), "Bağlantı ayarları eksik veya geçersiz");
  assert.equal(supplierRunError("contract: Contract", "dinamik"), "Yanıt beklenen biçimde değil");
  assert.equal(supplierRunError("busy"), "Başka bir çekim sürüyordu; bu deneme başlatılmadı");
  assert.equal(supplierRunError("something-new: x"), "Servis veya kayıt işlemi tamamlanamadı");
});

test("the overview's importErrorLabel is the same mapping", () => {
  assert.equal(importErrorLabel("upstream: getStockList: HTTP 500", "dinamik"), supplierRunError("upstream: getStockList: HTTP 500", "dinamik"));
  assert.equal(importErrorLabel("product-drop-over-20-percent"), supplierRunError("product-drop-over-20-percent"));
  assert.equal(importErrorLabel(null), "Neden kaydedilmemiş");
});
