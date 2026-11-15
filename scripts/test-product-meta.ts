import test from "node:test";
import assert from "node:assert/strict";
import { readableProductName, vehicleLabel, primaryVehicle, modelKeyword } from "../src/modules/store/product-name";
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
  assert.equal(primaryVehicle(models, "MAZOT FILTRESI"), null);
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
    "CONTINENTAL-D LTRC353196 Kış Lastiği. 205/55R16 91H Continental TS830P SSR *.");
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

test("DIS is diş after a count or beside KALIN / INCE / SAYISI, else dış", () => {
  assert.equal(readableProductName("TETIK DISLISI (119 DIS)"), "Tetik Dişlisi (119 Diş)");
  assert.equal(readableProductName("MARS MOTORU 12V 8 DIS"), "Marş Motoru 12V 8 Diş");
  assert.equal(readableProductName("VOLAN DIS SAYISI:26"), "Volan Diş Sayısı:26");
  assert.equal(readableProductName("TRIGER KASNAGI KALIN DIS"), "Triger Kasnağı Kalın Diş");
  assert.equal(readableProductName("TRIGER KASNAGI (INCE DIS)"), "Triger Kasnağı (İnce Diş)");
  assert.equal(readableProductName("DIS DIKIZ AYNASI SAG"), "Dış Dikiz Aynası Sağ");
});

test("ambiguous words stay as the supplier wrote them", () => {
  assert.equal(readableProductName("KAPI DISI"), "Kapı Disi");
  assert.equal(readableProductName("ARAC DISI SICAKLIK SENSORU"), "Araç Disi Sıcaklık Sensörü");
  assert.equal(readableProductName("RENAULT VEL SATIS 2002>"), "Renault Vel Satis 2002>");
  assert.equal(readableProductName("GAZ KELEBEGI"), "Gaz Kelebeği");
  assert.equal(readableProductName("GAZ PEDALI"), "Gaz Pedalı");
});

test("the first letter is capitalized and marks are separators", () => {
  assert.equal(readableProductName("***DESEN"), "***Desen");
  assert.equal(readableProductName("[CAP] KAPAK"), "[Cap] Kapak");
  assert.equal(readableProductName("{FARKLI} SET"), "{Farklı} Set");
  assert.equal(readableProductName("*OE* FILTRE"), "*OE* Filtre");
  assert.equal(readableProductName("''FIAT'' FILTRE"), "''Fiat'' Filtre");
  assert.equal(readableProductName("ABS'LI TEKER"), "ABS'li Teker");
});

test("a token with a lower case letter stays, upper case tokens convert; people-written names are untouched", () => {
  assert.equal(readableProductName("SILECEK SUPURGESI 530mm GOLF III IV"), "Silecek Süpürgesi 530mm Golf III IV");
  assert.equal(readableProductName("TERMOSTAT 93°c MEGANE III"), "Termostat 93°c Megane III");
  assert.equal(readableProductName("DISLI 5x100"), "Dişli 5x100");
  for (const written of ["Hava Filtresi", "FEBI Kapı Dış Açma Kolu Sağ", "Plastık Derın Koruyucu 250 ml", "BOSCH Fren Diski", "Yağ Filtresi (Elle) BMW 3"]) assert.equal(readableProductName(written), written);
});

test("a repeated word goes only at the end of the name", () => {
  assert.equal(readableProductName("CLIO CLIO II EXPRESS"), "Clio Clio II Express");
  assert.equal(readableProductName("GOLF GOLF VIII"), "Golf Golf VIII");
  assert.equal(readableProductName("GRANDE PUNTO PUNTO EVO"), "Grande Punto Punto Evo");
  assert.equal(readableProductName("MEGANE I II II SCENIC"), "Megane I II II Scenic");
  assert.equal(readableProductName("HAVA FILTRE FILTRE"), "Hava Filtre");
});

test("Turkish capitals and dotless I", () => {
  assert.equal(readableProductName("ILERI GERI"), "İleri Geri");
  assert.equal(readableProductName("İLERİ İNCE"), "İleri İnce");
  assert.equal(readableProductName("BORU ÇAPI 12"), "Boru Çapı 12");
  assert.equal(readableProductName("ÇATALI ARAÇLARI"), "Çatalı Araçları");
  assert.equal(readableProductName("ONUN CAMI"), "Önün Camı");
});

test("vehicle labels keep model names with lower case letters and drop only listed body words", () => {
  assert.deepEqual(vehicleLabel("HYUNDAI ix35 (LM, EL, ELH)"), { full: "Hyundai ix35", short: "ix35" });
  assert.deepEqual(vehicleLabel("BMW iX3 (G08)"), { full: "BMW iX3", short: "iX3" });
  assert.deepEqual(vehicleLabel("TOYOTA bZ4X (XEBM)"), { full: "Toyota bZ4X", short: "bZ4X" });
  assert.deepEqual(vehicleLabel("FIAT 500e Hatchback"), { full: "Fiat 500e", short: "500e" });
  assert.deepEqual(vehicleLabel("MERCEDES-BENZ CLA Coupe (C117)"), { full: "Mercedes-Benz CLA", short: "CLA" });
  assert.deepEqual(vehicleLabel("VOLKSWAGEN GOLF IV Station Wagon"), { full: "Volkswagen Golf IV", short: "Golf IV" });
  assert.equal(vehicleLabel("MINI MINI (R50)").full, "Mini");
  assert.deepEqual(vehicleLabel("ALFA ROMEO"), { full: "Alfa Romeo", short: "" });
});

test("title: no suffix for a make-only or a nameless model; a model already in the name adds nothing", () => {
  const title = (vehicles: string[], hint = "", name = "Hava Filtresi") => productSeoTitle({ brand: "X", name, partNumber: "1", vehicles, hint });
  assert.equal(title(["HYUNDAI ix35 (LM)"]), "X Hava Filtresi 1 – Hyundai ix35 uyumlu");
  assert.equal(title(["BMW 3 (G20)"]), "X Hava Filtresi 1 – BMW 3 uyumlu");
  assert.equal(productSeoTitle({ brand: "BRAND", name: "Çok Uzun Bir Fren Balata Seti Ön Takım", partNumber: "ABCDEFGHIJ123", vehicles: ["FIAT 124 Spider"], hint: "" }),
    "BRAND Çok Uzun Bir Fren Balata Seti Ön Takım ABCDEFGHIJ123");
  assert.equal(title(["FIAT"]), "X Hava Filtresi 1");
  assert.equal(title(["HYUNDAI IX35 (LM)"], "", "Hava Filtresi ix35"), "X Hava Filtresi ix35 1");
  assert.equal(modelKeyword("FIAT 124 Spider"), "spider");
  assert.equal(modelKeyword("BMW 3 (G20)"), null);
});

test("primary vehicle: a list the hint does not name has no vehicle; the make stands in for one make", () => {
  assert.equal(primaryVehicle(["FIAT PUNTO (188)", "FIAT PANDA (169)"], "FILTRE"), null);
  assert.equal(primaryVehicle(["FIAT PUNTO (188)", "FIAT PUNTO Van"], "FILTRE"), "FIAT PUNTO (188)");
  assert.equal(primaryVehicle(["ALFA ROMEO MITO (955)", "FIAT PUNTO (188)", "LANCIA YPSILON (846)"], "FILTRE"), null);
  // Across more than two makes a hint match is a coincidence.
  assert.equal(primaryVehicle(["ALFA ROMEO MITO (955)", "FIAT PUNTO (188)", "LANCIA YPSILON (846)"], "FILTRE PUNTO"), null);
  assert.equal(primaryVehicle(["FIAT PUNTO (188)", "LANCIA YPSILON (846)"], "FILTRE PUNTO"), "FIAT PUNTO (188)");
  const title = (vehicles: string[], hint = "", brand = "X") => productSeoTitle({ brand, name: "Filtre", partNumber: "1", vehicles, hint });
  assert.equal(title(["FIAT PUNTO (188)", "FIAT PANDA (169)"]), "X Filtre 1 – Fiat uyumlu");
  assert.equal(title(["LAND ROVER DEFENDER", "LAND ROVER FREELANDER"]), "X Filtre 1 – Land Rover uyumlu");
  assert.equal(title(["FIAT PUNTO (188)", "FIAT PANDA (169)"], "", "FIAT"), "FIAT Filtre 1");
  assert.equal(title(["FIAT PUNTO (188)", "FIAT PANDA (169)"], "PANDA"), "X Filtre 1 – Fiat Panda uyumlu");
  assert.equal(title(["FIAT PUNTO (188)", "LANCIA YPSILON (846)"]), "X Filtre 1");
  assert.equal(title(["DAIHATSU ROCKY", "HYUNDAI H100 Bus", "FIAT PUNTO"], "H100"), "X Filtre 1");
  assert.equal(title(["MINI HATCHBACK"]), "X Filtre 1");
  assert.equal(vehicleLabel("MINI Hatchback").short, "");
  assert.equal(productSeoTitle({ brand: "OPAR", name: "Filtre", partNumber: "46797936", vehicles: ["ALFA ROMEO MITO (955)", "FIAT PUNTO (188)", "LANCIA YPSILON (846)"], hint: "" }), "OPAR Filtre 46797936");
});

test("description: the product text is readable and a text without letters is skipped", () => {
  assert.equal(productSeoDescription({ brand: "A", name: "Ad", partNumber: "1", vehicles: [], text: "SURGULU KAPAK" }), "A 1 Ad. Sürgülü Kapak.");
  assert.equal(productSeoDescription({ brand: "A", name: "Ad", partNumber: "1", vehicles: [], text: "." }), "A 1 Ad.");
});

test("a multi-word brand loses its first word at the start of the part number", () => {
  const title = (brand: string, partNumber: string) => productSeoTitle({ brand, name: "Dikiz Aynası", partNumber, vehicles: [], hint: "" });
  assert.equal(title("KRAFTVOLL DIKIZ AYNASI", "KRAFTVOLL 09080074"), "KRAFTVOLL DIKIZ AYNASI Dikiz Aynası 09080074");
  assert.equal(title("KALE RADYATOR", "KALE 123456"), "KALE RADYATOR Dikiz Aynası 123456");
  assert.equal(title("PSA ORIJINAL", "PSA 1618Q4"), "PSA ORIJINAL Dikiz Aynası 1618Q4");
  assert.equal(title("KALE RADYATOR", "KALE RADYATOR 123456"), "KALE RADYATOR Dikiz Aynası 123456");
  assert.equal(title("KALE RADYATOR", "KALE"), "KALE RADYATOR Dikiz Aynası KALE");
  assert.equal(productSeoDescription({ brand: "KALE RADYATOR", name: "Radyatör", partNumber: "KALE 123456", vehicles: [] }), "KALE RADYATOR 123456 Radyatör.");
});

test("a name with a third of its letters in lower case is a human's; a stray written word does not protect an upper case name", () => {
  assert.equal(readableProductName("YAG FILTRESI Gri"), "Yağ Filtresi Gri");
  assert.equal(readableProductName("LM51 2-COMPONENTS 1 Kg"), "LM51 2-Components 1 Kg");
  assert.equal(readableProductName("ON AMORTISOR Sol"), "Ön Amortisör Sol");
  for (const written of ["Hava Filtresi", "Yağ Filtresi (Elle) BMW 3", "FEBI Kapı Dış Açma Kolu Sağ", "Motor Yağı 5W30 5 Litre", "Disk Fren Balatası Sağ ÖN"]) assert.equal(readableProductName(written), written);
});

test("models and technical codes stay upper case, real words and Mito are converted", () => {
  const cases: [string, string][] = [
    ["MAN TGA TGS TGX", "MAN TGA TGS TGX"], ["FORD KA FIESTA", "Ford KA Fiesta"], ["VW UP GOLF", "VW UP Golf"], ["TOYOTA RAV 4", "Toyota RAV 4"],
    ["MITSUBISHI ASX", "Mitsubishi ASX"], ["W118 CLA ON SOL", "W118 CLA Ön Sol"], ["W167 GLE 19>", "W167 GLE 19>"], ["LEXUS IS XE", "Lexus IS XE"],
    ["MERCEDES EQC EQS", "Mercedes EQC EQS"], ["P206 GTI", "P206 GTI"], ["RENAULT MAGNUM DXI 440", "Renault Magnum DXI 440"], ["STAREX TCI", "Starex TCI"],
    ["DSG KARTER VAG GRUBU", "DSG Karter VAG Grubu"], ["MITSUBISHI L200 DID", "Mitsubishi L200 DID"], ["SANDERO 1.0 SCE", "Sandero 1.0 SCE"], ["FORD USA EXPLORER", "Ford USA Explorer"],
    ["EPS EGZOZ BASINC SENSORU", "EPS Egzoz Basınç Sensörü"], ["FIESTA 1.25 EFI 16V", "Fiesta 1.25 EFI 16V"], ["GOLF 1.9 TDI AXD", "Golf 1.9 TDI AXD"],
    ["ALFA ROMEO MITO", "Alfa Romeo Mito"], ["SOL ALT FAR ARKA", "Sol Alt Far Arka"], ["IS MAKINASI STOP", "İş Makinası Stop"], ["TOYOTA HILUX PICK-UP", "Toyota Hilux Pick-Up"],
    ["NISSAN PICK UP 2.4", "Nissan Pick Up 2.4"],
  ];
  for (const [raw, expected] of cases) assert.equal(readableProductName(raw), expected, raw);
});

test("DIS before FREZE is dış even after a count; the tooth rules stay", () => {
  assert.equal(readableProductName("KAMA 2 DIS FREZE 12"), "Kama 2 Dış Freze 12");
  assert.equal(readableProductName("AKS (DIS FREZE:23 IC FREZE:26)"), "Aks (Dış Freze:23 İç Freze:26)");
  assert.equal(readableProductName("AKS 25 DIS FREEZE"), "Aks 25 Dış Freeze");
  assert.equal(readableProductName("MARS MOTORU 12V 8 DIS"), "Marş Motoru 12V 8 Diş");
});

test("mixed Turkish letters and ASCII I: frequent words are in the dictionary", () => {
  const cases: [string, string][] = [
    ["ÜNIVERSAL STOP", "Üniversal Stop"], ["H100 MINIBÜS", "H100 Minibüs"], ["DIRENÇ", "Direnç"], ["ÇEKICI", "Çekici"], ["UNIVERSAL MINIBUS", "Üniversal Minibüs"],
    ["HÜRLIMANN TRAKTÖR", "Hürlimann Traktör"], ["GÜÇLENDIRILMIS", "Güçlendirilmiş"],
  ];
  for (const [raw, expected] of cases) assert.equal(readableProductName(raw), expected, raw);
});

test("apostrophes: the ending is lower case, after a count it follows the number's vowel", () => {
  const cases: [string, string][] = [
    ["4'LU PAKET", "4'lü Paket"], ["2'LI SET", "2'li Set"], ["6'LI SET", "6'lı Set"], ["3'LU", "3'lü"], ["9'LU", "9'lu"], ["10'LU", "10'lu"], ["20'LI", "20'li"],
    ["100'LUK", "100'lük"], ["LION'S CITY", "Lion's City"], ["KIA CEE'D", "Kia Cee'd"], ["ABS'LI TEKER", "ABS'li Teker"], ["SANTA FÉ", "Santa Fé"],
  ];
  for (const [raw, expected] of cases) assert.equal(readableProductName(raw), expected, raw);
});
