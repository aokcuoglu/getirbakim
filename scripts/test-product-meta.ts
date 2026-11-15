import test from "node:test";
import assert from "node:assert/strict";
import { readableProductName, vehicleLabel, primaryVehicle } from "../src/modules/store/product-name";
import { productSeoDescription, productSeoTitle } from "../src/modules/seo/product-meta";
import { productMeta, productTitle, type StoreOverride } from "../src/modules/store/product-override-display";

test("tokens: foreign words stay plain, codes and abbreviations stay", () => {
  const cases: [string, string][] = [
    ["INSIGNIA", "Insignia"], ["IBIZA", "Ibiza"], ["IVECO", "Iveco"], ["IC", "İç"], ["ISITMALI", "Isıtmalı"], ["III", "III"], ["TDI", "TDI"],
    ["1.6HDI", "1.6HDI"], ["BMW", "BMW"], ["MERCEDES-BENZ", "Mercedes-Benz"], ["CITROËN", "Citroën"], ["FILTRESI GENEL GENEL", "Filtresi"],
    ["CONTASI", "Contası"], ["S-CROSS", "S-Cross"], ["FILTRE FILTRE", "Filtre"], ["12V", "12V"], ["IÇIN", "İçin"],
  ];
  for (const [raw, expected] of cases) assert.equal(readableProductName(raw), expected, raw);
});

test("a name with a lower case letter is returned as is", () => {
  assert.equal(readableProductName("Plastık Derın Koruyucu 250 ml"), "Plastık Derın Koruyucu 250 ml");
  assert.equal(readableProductName("Hava Filtresi"), "Hava Filtresi");
});

test("the supplier names of the design table", () => {
  const cases: [string, string][] = [
    ["YAG FILTRESI GENEL GENEL", "Yağ Filtresi"],
    ["RADYATOR SU HORTUMU", "Radyatör Su Hortumu"],
    ["SINYAL LAMBASI SOL", "Sinyal Lambası Sol"],
    ["V KAYIS SETI", "V Kayış Seti"],
    ["KALORIFER RADYATORU", "Kalorifer Radyatörü"],
    ["DENGE KOLU ARKA ON MERCEDES SPRINTER 19>", "Denge Kolu Arka Ön Mercedes Sprinter 19>"],
    ["ALTERNATOR (12V 150A) W202 97>00", "Alternatör (12V 150A) W202 97>00"],
    ["MARSBIYEL BRAKETI G20 ON IC SOL CAMURLUK 2017-", "Marsbiyel Braketi G20 Ön İç Sol Çamurluk 2017-"],
    ["KIS LASTIGI", "Kış Lastiği"],
    ["FAR KOMPLE (BEYAZ CIZGILI) SAGSANDERO STEPWAY 2023-", "Far Komple (Beyaz Çizgili) Sagsandero Stepway 2023-"],
  ];
  for (const [raw, expected] of cases) assert.equal(readableProductName(raw), expected, raw);
});

test("vehicle labels drop chassis codes and body words", () => {
  assert.deepEqual(vehicleLabel("RENAULT MEGANE III Hatchback (BZ0/1_, B3_)"), { full: "Renault Megane III", short: "Megane III" });
  assert.deepEqual(vehicleLabel("FORD TRANSIT Bus (E_ _)"), { full: "Ford Transit", short: "Transit" });
  assert.deepEqual(vehicleLabel("LAND ROVER DEFENDER Station Wagon"), { full: "Land Rover Defender", short: "Defender" });
  assert.deepEqual(vehicleLabel("BMW 3 (G20, G80)"), { full: "BMW 3", short: "3" });
});

test("the primary vehicle is the one the name or description mentions", () => {
  const models = ["DAIHATSU ROCKY", "HYUNDAI H100 Bus"];
  assert.equal(primaryVehicle(models, "MAZOT FILTRESI H100 97>"), "HYUNDAI H100 Bus");
  assert.equal(primaryVehicle(models, "MAZOT FILTRESI"), "DAIHATSU ROCKY");
  assert.equal(primaryVehicle([], "X"), null);
});

const megane = ["RENAULT MEGANE III Hatchback (BZ0/1_, B3_)", "RENAULT MEGANE III Grandtour (KZ0/1)", "RENAULT MEGANE III Coupe (DZ0/1)", "RENAULT MEGANE III Saloon"];

test("titles of the design table", () => {
  const rows: { in: Parameters<typeof productSeoTitle>[0]; out: string }[] = [
    { in: { brand: "ORIJINAL", name: "Yağ Filtresi", partNumber: "ORJINAL 1520900Q0H", vehicles: megane, hint: "YAG FILTRESI GENEL GENEL" }, out: "ORIJINAL Yağ Filtresi ORJINAL 1520900Q0H – Megane III uyumlu" },
    { in: { brand: "FEBI", name: "Radyatör Su Hortumu", partNumber: "175566", vehicles: [], hint: "" }, out: "FEBI Radyatör Su Hortumu 175566" },
    { in: { brand: "DEPO", name: "Sinyal Lambası Sol", partNumber: "214-1531L-UE", vehicles: ["MITSUBISHI PAJERO II (V3_W, V2_W)"], hint: "" }, out: "DEPO Sinyal Lambası Sol 214-1531L-UE – Pajero II uyumlu" },
    { in: { brand: "INA", name: "V Kayış Seti", partNumber: "529 0389 10", vehicles: ["FORD TRANSIT Bus (E_ _)"], hint: "" }, out: "INA V Kayış Seti 529 0389 10 – Ford Transit uyumlu" },
    { in: { brand: "DELPHI", name: "Denge Kolu Arka Ön Mercedes Sprinter 19>", partNumber: "TC8392", vehicles: ["MERCEDES-BENZ SPRINTER 3-t Bus (903)"], hint: "DENGE KOLU ARKA ON MERCEDES SPRINTER 19>" }, out: "DELPHI Denge Kolu Arka Ön Mercedes Sprinter 19> TC8392" },
    { in: { brand: "MAHLE FILTRE", name: "Yağ Filtresi P208 P301 P308 P508 P2008 Partner Teppe Berlingo 1.6HDI", partNumber: "OX 171/2D1", vehicles: [], hint: "" }, out: "MAHLE FILTRE Yağ Filtresi P208 P301 P308 P508 OX 171/2D1" },
    { in: { brand: "WAI", name: "Alternatör (12V 150A) W202 97>00 W210 98>02 Vito 638 97>02 Sprinter 00>06", partNumber: "12384N", vehicles: [], hint: "" }, out: "WAI Alternatör (12V 150A) W202 97>00 W210 98>02 Vito 12384N" },
    { in: { brand: "SETA", name: "Hava Filtresi", partNumber: "STA-1573", vehicles: ["SUZUKI SX4 S-CROSS (JY)", "SUZUKI VITARA (LY)"], hint: "VITARA 1.6" }, out: "SETA Hava Filtresi STA-1573 – Suzuki Vitara uyumlu" },
    { in: { brand: "CONTINENTAL-D", name: "Kış Lastiği", partNumber: "LTRC353196", vehicles: [], hint: "" }, out: "CONTINENTAL-D Kış Lastiği LTRC353196" },
  ];
  for (const row of rows) {
    const title = productSeoTitle(row.in);
    assert.ok(title.length <= 60, `${title} (${title.length})`);
    assert.ok(title.startsWith(row.in.brand) && title.includes(row.in.partNumber), title);
    assert.equal(title, row.out);
  }
});

test("title never cuts the brand or the part number and drops an open parenthesis", () => {
  const title = productSeoTitle({ brand: "BRAND", name: "Çok Uzun Bir Ürün Adı (Ve Parantezli Açıklaması Burada Devam Eder)", partNumber: "ABC-123-XYZ", vehicles: [], hint: "" });
  assert.equal(title, "BRAND Çok Uzun Bir Ürün Adı ABC-123-XYZ");
  const tight = productSeoTitle({ brand: "UZUN MARKA ADI", name: "Ad", partNumber: "PARCA-NO-0000000000000000000000000000000000000000000000", vehicles: [], hint: "" });
  assert.ok(tight.startsWith("UZUN MARKA ADI") && tight.endsWith("0000"), tight);
  assert.equal(productSeoTitle({ brand: "BOSCH", name: "Fren Diski", partNumber: "BOSCH 0986", vehicles: [], hint: "" }), "BOSCH Fren Diski 0986");
});

test("descriptions of the design table", () => {
  assert.equal(productSeoDescription({ brand: "ORIJINAL", name: "Yağ Filtresi", partNumber: "ORJINAL 1520900Q0H", vehicles: megane }),
    "ORIJINAL ORJINAL 1520900Q0H Yağ Filtresi. Uyumlu araçlar: Renault Megane III.");
  assert.equal(productSeoDescription({ brand: "FEBI", name: "Radyatör Su Hortumu", partNumber: "175566", oem: "1K0122101BQ", vehicles: [], text: "Otomatik" }),
    "FEBI 175566 Radyatör Su Hortumu. OEM: 1K0122101BQ. Otomatik.");
  assert.equal(productSeoDescription({ brand: "SETA", name: "Hava Filtresi", partNumber: "STA-1573", oem: "13780-62M00", vehicles: ["SUZUKI SX4 S-CROSS (JY)", "SUZUKI VITARA (LY)"], hint: "VITARA" }),
    "SETA STA-1573 Hava Filtresi. OEM: 13780-62M00. Uyumlu araçlar: Suzuki Vitara, Suzuki SX4 S-Cross.");
  assert.equal(productSeoDescription({ brand: "CONTINENTAL-D", name: "Kış Lastiği", partNumber: "LTRC353196", vehicles: [], text: "205/55R16 91H CONTINENTAL TS830P SSR *" }),
    "CONTINENTAL-D LTRC353196 Kış Lastiği. 205/55R16 91H CONTINENTAL TS830P SSR *.");
});

test("descriptions stay within 160, summarize many vehicles and cut the text at a word", () => {
  const many = Array.from({ length: 30 }, (_, index) => `FORD MODEL${"ABCDEFGHIJKLMNOPQRSTUVWXYZABCD"[index]} Sedan (X${index})`);
  const description = productSeoDescription({ brand: "FEBI", name: "Yağ Filtresi", partNumber: "1234", oem: "OEM9", vehicles: many, text: "Çok ".repeat(80) });
  assert.ok(description.length <= 160, String(description.length));
  assert.match(description, /Uyumlu araçlar: Ford Modela, .* ve \d+ model daha\./);
  assert.ok(description.endsWith("Çok…"));
  assert.ok(!/fiyat|stok/i.test(description));
});

test("an admin's name and SEO fields stay in front of the automatic ones", () => {
  const override: StoreOverride = { name: "Elle Ad", description: null, seo_title: "Elle başlık", seo_description: "Elle açıklama", category_id: null };
  assert.equal(productTitle(override, "Zengin", readableProductName("YAG FILTRESI")), "Elle Ad");
  assert.equal(productTitle(null, "Zengin", readableProductName("YAG FILTRESI")), "Zengin");
  assert.equal(productTitle(null, null, readableProductName("YAG FILTRESI")), "Yağ Filtresi");
  assert.deepEqual(productMeta(override, { title: "Otomatik", description: "Otomatik" }), { title: "Elle başlık", description: "Elle açıklama" });
});
