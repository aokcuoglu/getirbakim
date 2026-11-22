import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManualBulkCsv, decodeCsv, diffManualBulk, manualBulkListCell, manualCost, parseBulkNumber, parseCsv, parseManualBulkCsv,
  type ManualBulkCurrent } from "../src/modules/suppliers/manual-bulk-csv";
import { manualBulkPage, manualBulkPageSize } from "../src/modules/suppliers/manual-bulk-paging";

const utf8 = (text: string) => new TextEncoder().encode(text);
const item = (overrides: Partial<ManualBulkCurrent> = {}): ManualBulkCurrent => ({ id: "a", code: "100047", brand: "MOTUL", list: 1000, discount: 0, markup: null,
  stock: 3, cost: 1000, filePrice: 1000, fileStock: 3, fixedPrice: false, ...overrides });
const header = "Marka;Stok Kodu;Liste Fiyatı;İskonto Oranı;Kârlılık Oranı;Stok Adedi";
const parse = (lines: string[]) => parseManualBulkCsv(utf8([header, ...lines].join("\r\n")));
const errors = (result: { issues: { level: string; message: string }[] }) => result.issues.filter(issue => issue.level === "error").map(issue => issue.message);

test("a downloaded list read back changes nothing (BOM, ;, Turkish decimals, zero-padded codes)", () => {
  const current = [item(), item({ id: "b", code: "00123", brand: "Castrol", list: 1234.56, discount: 12.5, cost: manualCost(1234.56, 12.5), markup: 35.25, stock: null }),
    item({ id: "c", code: "4006633123456", brand: "Liqui; Moly", list: null, cost: null, stock: 0 })];
  const csv = buildManualBulkCsv(current.map(entry => ({ brand: entry.brand, code: entry.code, list: entry.list, discount: entry.discount, markup: entry.markup, stock: entry.stock })));
  assert.ok(csv.startsWith("﻿Marka;Stok Kodu;"));
  assert.match(csv, /;="00123";1234,56;12,5;35,25;\r\n/);
  assert.match(csv, /"Liqui; Moly";="4006633123456";;;;0\r\n/);
  const parsed = parseManualBulkCsv(utf8(csv));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.rows[1].code, "00123");
  const diff = diffManualBulk(parsed.rows, current);
  assert.deepEqual(diff, { changes: [], unchanged: 3, issues: [] });
});

test("number formats follow the delimiter", () => {
  assert.equal(parseBulkNumber("1.234,56", ","), 1234.56);
  assert.equal(parseBulkNumber("1.234", ","), 1234);
  assert.equal(parseBulkNumber("1234.56", ","), 1234.56);
  assert.equal(parseBulkNumber("1 234,5 TL", ","), 1234.5);
  assert.equal(parseBulkNumber("%12,5", ","), 12.5);
  assert.equal(parseBulkNumber("₺99", ","), 99);
  assert.equal(parseBulkNumber("", ","), null);
  assert.equal(parseBulkNumber("12,3,4", ","), "invalid");
  assert.equal(parseBulkNumber("abc", ","), "invalid");
  assert.equal(parseBulkNumber("1234.56", "."), 1234.56);
  assert.equal(parseBulkNumber("1,234.56", "."), 1234.56);
  const comma = parseManualBulkCsv(utf8("Marka,Stok Kodu,Liste Fiyatı,Stok Adedi\nMOTUL,100047,1234.5,7\n"));
  assert.deepEqual(comma.rows, [{ row: 2, brand: "MOTUL", code: "100047", listPrice: 1234.5, discount: null, markup: null, stock: 7 }]);
});

test("Windows Turkish and UTF-16 files, quoted fields and header order", () => {
  const latin = Buffer.from("Stok Kodu;Marka;\xDDskonto Oran\xFD\r\n100047;MOTUL;10\r\n", "latin1");
  assert.equal(decodeCsv(latin).split("\r\n")[0], "Stok Kodu;Marka;İskonto Oranı");
  assert.deepEqual(parseManualBulkCsv(latin).rows, [{ row: 2, brand: "MOTUL", code: "100047", listPrice: null, discount: 10, markup: null, stock: null }]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Marka\tStok Kodu\tStok Adedi\r\nMOTUL\t100047\t5\r\n", "utf16le")]);
  assert.equal(parseManualBulkCsv(utf16).rows[0].stock, 5);
  assert.deepEqual(parseCsv("a;b\r\n\"x;\"\"y\"\"\";\"line\nbreak\"\r\n").rows, [["a", "b"], ["x;\"y\"", "line\nbreak"]]);
});

test("cost is the list price less the discount, rounded to four decimals", () => {
  assert.equal(manualCost(1000, 0), 1000);
  assert.equal(manualCost(1000, 12.5), 875);
  assert.equal(manualCost(1000, 100), 0);
  assert.equal(manualCost(10.005, 0), 10.005);
  assert.equal(manualCost(33.33, 33.33), 22.2211);
});

test("format errors are reported per row", () => {
  const result = parse(["MOTUL;100047;0;;;", "MOTUL;100048;;101;;", "MOTUL;100049;;;;-1", "MOTUL;100050;;;;1,5", "MOTUL;100051;;;1000,5;", "MOTUL;100052;abc;;;", ";;;;;5"]);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(errors(result), ["Liste Fiyatı sıfırdan büyük olmalı", "İskonto Oranı 0–100 arasında olmalı: 101",
    "Stok Adedi sıfır ya da pozitif tam sayı olmalı: -1", "Stok Adedi sıfır ya da pozitif tam sayı olmalı: 1,5",
    "Kârlılık Oranı 0–1.000 arasında, en fazla iki ondalıklı olmalı: 1000,5", "Liste Fiyatı sayı değil: \"abc\"", "Stok Kodu boş", "Marka boş"]);
  assert.deepEqual(errors(parseManualBulkCsv(utf8("Marka;Liste Fiyatı\nMOTUL;5\n"))), ["Zorunlu sütun yok: Stok Kodu"]);
});

test("diff: empty cells keep values, '-' resets markup, changes carry old and new values", () => {
  const current = [item({ markup: 40 }), item({ id: "b", code: "200", stock: 1 })];
  const { rows } = parse(["MOTUL;100047;;;;", "MOTUL;200;;;;"]);
  assert.deepEqual(diffManualBulk(rows, current), { changes: [], unchanged: 2, issues: [] });
  const changed = diffManualBulk(parse(["motul ;100047;1.200;10;-;", "MOTUL;200;;;25;4"]).rows, current);
  assert.deepEqual(changed.issues, []);
  assert.deepEqual(changed.changes, [
    { id: "a", row: 2, code: "100047", brand: "MOTUL", listPrice: [1000, 1200], discount: [0, 10], cost: [1000, 1080], markup: [40, null] },
    { id: "b", row: 3, code: "200", brand: "MOTUL", markup: [null, 25], stock: [1, 4] },
  ]);
});

test("diff errors: unknown key, brand mismatch, duplicate, discount without a list price", () => {
  const current = [item(), item({ id: "b", code: "300", list: null, cost: null })];
  const result = diffManualBulk(parse(["MOTUL;999;;;;1", "CASTROL;100047;;;;1", "MOTUL;100047;;;;1", "MOTUL;100047;;;;2", "MOTUL;300;;10;;"]).rows, current);
  assert.deepEqual(errors(result), ["Marka + Stok Kodu bu listede yok", "Marka bu ürünle uyuşmuyor (listede: MOTUL)",
    "Ürün dosyada tekrar ediyor (ilk: satır 4)", "İskonto girildi ama ürünün liste fiyatı yok; Liste Fiyatı da girin"]);
  assert.equal(result.changes.length, 1);
  // A list price with the discount opens a priceless product.
  assert.deepEqual(diffManualBulk(parse(["MOTUL;300;500;10;;"]).rows, current).changes[0].cost, [null, 450]);
});

test("diff warnings: tenfold price change, full discount, panel fixed price", () => {
  const result = diffManualBulk(parse(["MOTUL;100047;20.000;;;", "MOTUL;200;;100;;"]).rows, [item(), item({ id: "b", code: "200", fixedPrice: true })]);
  assert.deepEqual(errors(result), []);
  assert.deepEqual(result.issues.map(issue => issue.message), ["Liste fiyatı 10 kattan fazla değişiyor: 1000 → 20000",
    "İskonto %100: maliyet 0 olur, ürün satışa kapanır", "Üründe panelden girilmiş sabit ya da kampanya fiyatı var; maliyet değişir, mağaza fiyatı değişmez"]);
});

test("a code Excel stripped of its leading zeros finds its single item", () => {
  const current = [item({ code: "00123" })];
  assert.equal(diffManualBulk(parse(["MOTUL;123;;;;9"]).rows, current).changes[0].code, "00123");
  // Ambiguous: two items differ only by leading zeros.
  assert.deepEqual(errors(diffManualBulk(parse(["MOTUL;123;;;;9"]).rows, [...current, item({ id: "b", code: "0123" })])), ["Marka + Stok Kodu bu listede yok"]);
});

test("Excel-sensitive cells: a lone zero before the dot is a decimal; formula-like brands and date-like codes stay text", () => {
  assert.equal(parseBulkNumber("0.250", ","), 0.25);
  assert.equal(parseBulkNumber("0,250", ","), 0.25);
  const current = [item({ brand: "-ABC", code: "1E5" }), item({ id: "b", code: "3.4.2020" }), item({ id: "c", code: "12-34", brand: "=SUM" })];
  const csv = buildManualBulkCsv(current.map(entry => ({ brand: entry.brand, code: entry.code, list: entry.list, discount: entry.discount, markup: entry.markup, stock: entry.stock })));
  assert.match(csv, /\r\n'-ABC;="1E5";/);
  assert.match(csv, /\r\nMOTUL;="3\.4\.2020";/);
  assert.match(csv, /\r\n'=SUM;="12-34";/);
  const parsed = parseManualBulkCsv(utf8(csv));
  assert.deepEqual(parsed.rows.map(row => [row.brand, row.code]), [["-ABC", "1E5"], ["MOTUL", "3.4.2020"], ["=SUM", "12-34"]]);
  assert.deepEqual(diffManualBulk(parsed.rows, current), { changes: [], unchanged: 3, issues: [] });
});

test("a code starting with - is exported as is, so the list reads back unchanged", () => {
  const current = [item({ code: "-123" })];
  const csv = buildManualBulkCsv([{ brand: "MOTUL", code: "-123", list: 1000, discount: 0, markup: null, stock: 3 }]);
  assert.ok(csv.includes("\r\nMOTUL;-123;1000;0;;3\r\n"));
  assert.deepEqual(diffManualBulk(parseManualBulkCsv(utf8(csv)).rows, current), { changes: [], unchanged: 1, issues: [] });
});

test("an exact code with a zero-padded twin in the list is applied with a warning", () => {
  const result = diffManualBulk(parse(["MOTUL;0123;;;;9"]).rows, [item({ code: "0123" }), item({ id: "b", code: "123" })]);
  assert.equal(result.changes[0].code, "0123");
  assert.deepEqual(result.issues.map(issue => [issue.level, issue.message.replace(/;.*$/, "")]), [["warning", "Listede baştaki sıfırlar dışında aynı olan başka kod var (123)"]]);
});

test("draft table paging clamps the page to 1..pages (#840)", () => {
  assert.deepEqual(manualBulkPage(undefined, 0), { page: 1, pages: 1, offset: 0 });
  assert.deepEqual(manualBulkPage("2", 250), { page: 2, pages: 3, offset: manualBulkPageSize });
  assert.deepEqual(manualBulkPage("99", 250), { page: 3, pages: 3, offset: 2 * manualBulkPageSize });
  assert.deepEqual(manualBulkPage("0", 250), { page: 1, pages: 3, offset: 0 });
  assert.deepEqual(manualBulkPage("-1", 250).page, 1);
  assert.deepEqual(manualBulkPage("abc", 250).page, 1);
  assert.equal(manualBulkPage("1", manualBulkPageSize).pages, 1);
  assert.equal(manualBulkPage("1", manualBulkPageSize + 1).pages, 2);
});

// All-lists file (#844): a leading Liste column with the list's name keys rows by Liste + Marka + Stok Kodu.
const lists = [{ group: "madeni-yaglar", name: "Madeni Yağlar" }, { group: "filtreler", name: "Filtre; Hava" }, { group: "formul", name: "=Formül" }];

test("all-lists CSV: header, list column and the single-list output kept byte for byte (#844)", () => {
  const rows = [{ brand: "MOTUL", code: "100047", list: 1000, discount: 0, markup: null, stock: 3 }];
  assert.equal(buildManualBulkCsv(rows), "﻿Marka;Stok Kodu;Liste Fiyatı;İskonto Oranı;Kârlılık Oranı;Stok Adedi\r\nMOTUL;100047;1000;0;;3\r\n");
  const combined = buildManualBulkCsv([{ ...rows[0], listName: "Filtre; Hava" }, { ...rows[0], listName: "=Formül" }], true);
  assert.equal(combined, "﻿Liste;Marka;Stok Kodu;Liste Fiyatı;İskonto Oranı;Kârlılık Oranı;Stok Adedi\r\n\"Filtre; Hava\";MOTUL;100047;1000;0;;3\r\n'=Formül;MOTUL;100047;1000;0;;3\r\n");
});

test("all-lists CSV round trip: the same code in two lists changes nothing (#844)", () => {
  const current = [item({ listGroup: "madeni-yaglar" }), item({ id: "b", listGroup: "filtreler", stock: 7 }), item({ id: "c", listGroup: "formul", code: "00123", list: null, cost: null })];
  const name = (group: string) => lists.find(list => list.group === group)!.name;
  const csv = buildManualBulkCsv(current.map(entry => ({ brand: entry.brand, code: entry.code, list: entry.list, discount: entry.discount, markup: entry.markup,
    stock: entry.stock, listName: name(entry.listGroup!) })), true);
  const parsed = parseManualBulkCsv(utf8(csv), lists);
  assert.equal(parsed.combined, true);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows.map(row => [row.listGroup, row.listName]), [["madeni-yaglar", "Madeni Yağlar"], ["filtreler", "Filtre; Hava"], ["formul", "=Formül"]]);
  assert.deepEqual(diffManualBulk(parsed.rows, current), { changes: [], unchanged: 3, issues: [] });
});

test("all-lists CSV: unknown or empty list is a row error; names match regardless of case, slugs too (#844)", () => {
  const read = (lines: string[]) => parseManualBulkCsv(utf8([`Liste;${header}`, ...lines].join("\r\n")), lists);
  const unknown = read(["Yok Liste;MOTUL;100047;;;;1", ";MOTUL;100047;;;;1"]);
  assert.deepEqual(unknown.rows, []);
  assert.deepEqual(errors(unknown), ["Liste bulunamadı: \"Yok Liste\"", "Liste boş"]);
  assert.deepEqual(unknown.issues.map(issue => [issue.sheet, issue.field]), [["Yok Liste", null], ["", null]]);
  const found = read(["madeni yağlar;MOTUL;1;;;;1", "MADENİ YAĞLAR;MOTUL;2;;;;1", "filtreler;MOTUL;3;;;;1"]);
  assert.deepEqual(found.issues, []);
  assert.deepEqual(found.rows.map(row => row.listGroup), ["madeni-yaglar", "madeni-yaglar", "filtreler"]);
  // Row errors name the list.
  assert.deepEqual(read(["Madeni Yağlar;MOTUL;1;abc;;;"]).issues.map(issue => issue.sheet), ["Madeni Yağlar"]);
  // Without the Liste column the file is a single list's.
  const single = parse(["MOTUL;100047;;;;1"]);
  assert.equal(single.combined, false);
  assert.equal(single.rows[0].listGroup, undefined);
});

test("all-lists diff: a change goes only to the named list's item; a repeated item is an error (#844)", () => {
  const current = [item({ listGroup: "madeni-yaglar" }), item({ id: "b", listGroup: "filtreler" })];
  const read = (lines: string[]) => parseManualBulkCsv(utf8([`Liste;${header}`, ...lines].join("\r\n")), lists).rows;
  const result = diffManualBulk(read(["\"Filtre; Hava\";MOTUL;100047;;;;9"]), current);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.changes, [{ id: "b", row: 2, code: "100047", brand: "MOTUL", listName: "Filtre; Hava", stock: [3, 9] }]);
  const repeated = diffManualBulk(read(["filtreler;MOTUL;100047;;;;9", "filtreler;MOTUL;100047;;;;8", "madeni-yaglar;MOTUL;999;;;;1"]), current);
  assert.deepEqual(errors(repeated), ["Ürün dosyada tekrar ediyor (ilk: satır 2)", "Marka + Stok Kodu bu listede yok"]);
  assert.deepEqual(repeated.issues.map(issue => issue.sheet), ["Filtre; Hava", "Madeni Yağlar"]);
  // A single-list draft's rows belong to the default list.
  assert.equal(diffManualBulk(parse(["MOTUL;100047;;;;9"]).rows, current, "madeni-yaglar").changes[0].id, "a");
});

test("all-lists CSV: a name shared by two lists asks for the slug (#844)", () => {
  const twins = [{ group: "yaglar-1", name: "Yağlar" }, { group: "yaglar-2", name: "yağlar" }];
  const read = (cell: string) => parseManualBulkCsv(utf8([`Liste;${header}`, `${cell};MOTUL;1;;;;1`].join("\r\n")), twins);
  assert.deepEqual(errors(read("Yağlar")), ["Liste adı birden fazla listeyle eşleşiyor; liste kodunu (slug) yazın."]);
  assert.deepEqual(read("yaglar-2").rows.map(row => row.listGroup), ["yaglar-2"]);
});

test("all-lists download writes the slug for a name shared by several lists (#844)", () => {
  const twins = [{ group: "yaglar-1", name: "Yağlar" }, { group: "yaglar-2", name: "yağlar" }, { group: "filtre", name: "Filtre" }];
  assert.deepEqual(twins.map(list => manualBulkListCell(twins, list)), ["yaglar-1", "yaglar-2", "Filtre"]);
});
