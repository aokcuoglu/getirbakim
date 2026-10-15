import test from "node:test";
import assert from "node:assert/strict";
import { buildData, codeCandidates, fuelMap, identify, imageSize, parseProductPage, productImage, parseSearch, parseVehicles, toSourceVehicles, uniqueOems } from "../src/modules/enrichment/otoparcasan-adapter";
import { createFitmentMatcher } from "../src/modules/store/fitment-matcher";

// Trimmed from https://otoparcasan.com/salincak-on-ust-sol-teknorot-ki-209 (2026-10-14).
const photo = "https://image.otoparcasan.com/2o5zlnwgSrjo7Ies4fbg8w8dmv8=/fit-in/0x0/filters:fill(fff0)/products/salincak-on-ust-sol-teknorot-ki-209.png";
const page = `<meta property="og:image" content="${photo}" /><title>Salıncak Rotilli Ön Üst Sol TEKNOROT KI-209 | Otoparcasan.com</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Anasayfa"},{"@type":"ListItem","position":2,"name":"Yedek Parçalar"},{"@type":"ListItem","position":3,"name":"Süspansiyon ve Direksiyon"},{"@type":"ListItem","position":4,"name":"Salıncak"},{"@type":"ListItem","position":5,"name":"Salıncak Rotilli Ön Üst Sol TEKNOROT KI-209"}]}</script>
<div class="info-box-body"> <p class="oems">Bu ürüne ait bazı OEM kodları <span>544103E100</span> <span>54410-3E100</span> <span>544103</span> vb. şeklindedir.</p> </div>
<ul class="kriter-list"> <li><span>Montaj tarafı</span><span>Ön aksın solu</span></li> <li><span>Ağırlık [kg]</span><span>2,604</span></li>
 <li><span>Uzman personel tarafından montaj/demontaj gereklidir!</span><span></span></li> </ul>
<div class="navs-list"> <div class="item"> <button class="uyumluSelectButtons" data-stok="TKN KI-209" data-manuid="1500"> <img alt="HYUNDAI"> <h4>HYUNDAI</h4> </button> </div>
 <div class="item"> <button class="uyumluSelectButtons" data-stok="TKN KI-209" data-manuid="1504"> <img alt="KIA"> <h4>KIA</h4> </button> </div> </div>
<div class="productInfos"> <div class="item"><span>Marka :</span> TEKNOROT</div> <div class="item"><span>Stok Kodu :</span> KI-209</div> </div>`;
const car = { id: "1", manuId: "1500", manuName: "HYUNDAI", modelName: "GRANDEUR (TG)", typeName: "2.7", typeId: "1409", fuelType: "Benzin", constructionType: "Sedan",
  powerKw: "141", powerHp: "192", cylinderCapacityCcm: "2656", yearOfConstrFrom: "200605", yearOfConstrTo: "201010" };
const truck = { ...car, manuName: "IVECO", modelName: "EUROCARGO I-III", typeName: "190EL.28P", typeId: "18033", fuelType: "", constructionType: "Platform şasi",
  powerKw: "202", powerHp: "275", cylinderCapacityCcm: "5883", yearOfConstrFrom: "200205", yearOfConstrTo: "200707" };
const fuels = fuelMap([{ fuel_name: "Benzin", fuel_type: "Petrol" }, { fuel_name: "Dizel", fuel_type: "Diesel" }, { fuel_name: "Benzin / Elektrik", fuel_type: "Petrol/Electric" },
  { fuel_name: "Benzin / LPG", fuel_type: "Petrol/Liquified Petroleum Gas (LPG)" }]);

test("product page yields brand, stock code, OEM numbers, valued specifications and vehicle makes", () => {
  const parsed = parseProductPage(page);
  assert.equal(parsed.brand, "TEKNOROT");
  assert.equal(parsed.partNumber, "KI-209");
  assert.equal(parsed.category, "Süspansiyon ve Direksiyon / Salıncak");
  assert.deepEqual(parsed.oems, ["544103E100", "54410-3E100", "544103"]);
  assert.deepEqual(parsed.specifications, [["Montaj tarafı", "Ön aksın solu"], ["Ağırlık [kg]", "2,604"]]);
  assert.deepEqual(parsed.makers.map(m => [m.stok, m.manuId, m.name]), [["TKN KI-209", "1500", "HYUNDAI"], ["TKN KI-209", "1504", "KIA"]]);
  assert.throws(() => parseProductPage("<html></html>"), /stock code missing/);
});
test("search candidates must end with the stock code, not merely contain it", () => {
  const results = parseSearch({ status: true, response: { source: [
    { url: "yakit-filtresi-filfiltre-zp8098fmbp", urun_adi: "FIL FILTRE ZP 8098 FMBP" }, { url: "su-radyatoru-mga-80980", urun_adi: "MGA 80980" },
    { url: "yakit-filtresi-febibilstein-8098", urun_adi: "FEBI 8098" }] } });
  assert.deepEqual(codeCandidates(results, "8098"), ["yakit-filtresi-febibilstein-8098"]);
  assert.deepEqual(parseSearch({ status: false }), []);
});
test("commercial-vehicle rows are dropped and passenger rows map to the shared vehicle contract", () => {
  const rows = parseVehicles({ status: true, data: { cars: [car, truck, car, { ...car, typeId: "9", fuelType: "Benzin/elektrikli", typeName: "2.4 Hybrid" }, { ...car, typeId: "10", fuelType: "Benzin/oto gaz (LPG)" }, { ...car, typeId: "8", powerHp: "0" }] } });
  const result = toSourceVehicles(rows, fuels);
  assert.equal(result.commercial, 1);
  assert.deepEqual(result.vehicles[0], { model: "HYUNDAI GRANDEUR (TG)", engineAndCodes: "2.7", fuel: "Petrol", kw: 141, ps: 192, cc: 2656, from: "05/2006", to: "10/2010" });
  assert.equal(result.vehicles.length, 3, "duplicates removed, invalid row rejected");
  assert.deepEqual(result.vehicles.map(v => v.fuel), ["Petrol", "Petrol/Electric", "Petrol/Liquified Petroleum Gas (LPG)"]);
  assert.deepEqual(result.invalid.map(row => row.typeId), ["8"]);
  assert.equal(toSourceVehicles(parseVehicles({ status: true, data: { cars: [{ ...car, yearOfConstrTo: "" }] } }), fuels).vehicles[0].to, null);
  assert.deepEqual(parseVehicles({ status: false, data: null }), []);
});
test("source vehicles link to the catalog by model and type name through the strict matcher", () => {
  const { vehicles } = toSourceVehicles(parseVehicles({ status: true, data: { cars: [car, { ...car, typeId: "2", yearOfConstrFrom: "200606" }, { ...car, typeId: "3", manuName: "IVECO", fuelType: "" }] } }), fuels);
  const match = createFitmentMatcher([{ id: 1, brand_id: 1, brand: "HYUNDAI", display_brand: "HYUNDAI", name: "GRANDEUR (TG)" }],
    [{ id: 77, model_id: 1, name: "2.7", cc: 2656, fuel_type: "Petrol", hp: 192, kwt: 141, date_from: "2006-05", date_to: "2010-10" }]);
  assert.deepEqual(vehicles.map(match).map(row => [row.status, row.typeId]), [["matched", 77], ["dates_differ", null]]);
});
test("OEM numbers keep one spelling, drop truncated listings and are grouped under a known owner", () => {
  assert.deepEqual(uniqueOems(["544103E100", "54410-3E100", "544103", "MC140652"]), ["544103E100", "MC140652"]);
  const parsed = parseProductPage(page);
  assert.deepEqual(buildData(parsed, []).oemNumbers, { OE: ["544103E100"] });
  assert.deepEqual(buildData({ ...parsed, makers: [parsed.makers[0]] }, []).oemNumbers, { HYUNDAI: ["544103E100"] });
  assert.deepEqual(buildData({ ...parsed, brand: "PSA ORJINAL", makers: [] }, []).oemNumbers, { PSA: ["544103E100"] });
});
test("identity follows the import contract: brand/part, original part code or proven supplier OEM", () => {
  const parsed = parseProductPage(page), data = { oemNumbers: { OE: uniqueOems(parsed.oems) }, crossReferences: {} };
  assert.deepEqual(identify({ brand: "TEKNOROT", code: "TEKNOROT KI-209", oem: "" }, parsed, data), { type: "exact_part" });
  assert.equal(identify({ brand: "TEKNOROT", code: "TEKNOROT KI-208", oem: "" }, parsed, data), null);
  assert.equal(identify({ brand: "TEKNOROT SALINCAK", code: "TEKNOROT KI-209", oem: "" }, parsed, data), null);
  assert.deepEqual(identify({ brand: "TEKNOROT SALINCAK", code: "TEKNOROT KI-209", oem: "", masterBrand: "TEKNOROT" }, parsed, data), { type: "exact_part" });
  assert.deepEqual(identify({ brand: "MOOG", code: "MOOG HY-WP-1234", oem: "54410-3E100" }, parsed, data),
    { type: "oem_reference", reference: "54410-3E100", supplierOem: "54410-3E100", referenceSource: "supplier_oem" });
  assert.equal(identify({ brand: "MOOG", code: "MOOG HY-WP-1234", oem: "99999-9E999" }, parsed, data), null);
  const original = { ...parsed, brand: "PSA ORJINAL", partNumber: "9827578080" };
  assert.deepEqual(identify({ brand: "OE-PSA", code: "9827578080", oem: "" }, original, { oemNumbers: {}, crossReferences: {} }),
    { type: "oem_reference", reference: "9827578080", supplierOem: "", referenceSource: "original_manufacturer_part_code" });
});

test("the product photo is the og:image on the site's image host, never a placeholder or another host", () => {
  assert.equal(parseProductPage(page).image, photo);
  const meta = (url: string) => `<meta property="og:image" content="${url}" />`;
  assert.equal(productImage(meta("https://image.otoparcasan.com/x=/fit-in/400x400/filters:fill(fff0)/categories/urun-gorseli-hazirlanmaktadir.webp")), null);
  assert.equal(productImage(meta("https://image.otoparcasan.com/x=/fit-in/0x0/products/urun-gorseli-hazirlanmaktadir.webp")), null);
  assert.equal(productImage(meta("https://evil.example/products/a.png")), null);
  assert.equal(productImage(meta("http://image.otoparcasan.com/products/a.png")), null);
  assert.equal(productImage("<html></html>"), null);
});
test("image size is read from PNG, JPEG and WebP headers and rejects other bytes", () => {
  const png = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write("IHDR", 12); png.writeUInt32BE(600, 16); png.writeUInt32BE(399, 20);
  assert.deepEqual(imageSize(png), { width: 600, height: 399 });
  // SOI, an APP0 segment, then SOF2 (progressive) with height 300 and width 480.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xe0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { width: 480, height: 300 });
  const webp = Buffer.alloc(40); webp.write("RIFF", 0); webp.write("WEBP", 8); webp.write("VP8X", 12); webp.writeUIntLE(799, 24, 3); webp.writeUIntLE(599, 27, 3);
  assert.deepEqual(imageSize(webp), { width: 800, height: 600 });
  assert.equal(imageSize(Buffer.from("<!doctype html><html>error</html>")), null);
  assert.equal(imageSize(Buffer.alloc(0)), null);
});
