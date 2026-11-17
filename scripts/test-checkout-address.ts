import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { checkoutInput } from "../src/modules/store/checkout-schema";
import { composeAddress, districtsOf, findProvince, invoiceSummary, matchName, provinces } from "../src/modules/store/tr-address";

// Structured checkout address and invoice (#881); no database.

test("the province list holds Turkey's 81 provinces and 973 districts", () => {
  assert.equal(provinces.length, 81);
  assert.equal(provinces.reduce((count, province) => count + province.districts.length, 0), 973);
  assert.deepEqual(provinces.map(province => province.plate).sort((a, b) => a - b), Array.from({ length: 81 }, (_, i) => i + 1));
  assert.equal(new Set(provinces.map(province => province.name)).size, 81);
  for (const province of provinces) {
    assert.ok(province.districts.length > 0, province.name);
    assert.equal(new Set(province.districts).size, province.districts.length, province.name);
    assert.deepEqual(province.districts, [...province.districts].sort((a, b) => a.localeCompare(b, "tr")), province.name);
  }
  assert.deepEqual(provinces.map(province => province.name), provinces.map(province => province.name).sort((a, b) => a.localeCompare(b, "tr")));
  assert.equal(findProvince("İstanbul")?.plate, 34);
  assert.ok(districtsOf("İstanbul").includes("Kadıköy"));
  assert.ok(districtsOf("Ankara").includes("Çankaya"));
  assert.equal(findProvince("Istanbul"), null);
  assert.deepEqual(districtsOf("Yok"), []);
});

test("browser-filled text matches a name with Turkish case rules only when it is the whole name", () => {
  const names = provinces.map(province => province.name);
  assert.equal(matchName(names, "istanbul"), "İstanbul");
  assert.equal(matchName(names, " IĞDIR "), "Iğdır");
  assert.equal(matchName(names, "İstan"), null);
  assert.equal(matchName(names, ""), null);
});

test("the combined address and the corporate invoice summary", () => {
  assert.equal(composeAddress({ line: "Caferağa Mah. Moda Cad. No 1 D 2", district: "Kadıköy", province: "İstanbul", postalCode: "34710" }),
    "Caferağa Mah. Moda Cad. No 1 D 2, 34710 Kadıköy/İstanbul");
  assert.equal(composeAddress({ line: "Atatürk Bulvarı No 1", district: "Çankaya", province: "Ankara", postalCode: null }), "Atatürk Bulvarı No 1, Çankaya/Ankara");
  assert.equal(invoiceSummary({ invoice_type: "corporate", invoice_company: "Yılmaz Otomotiv", invoice_tax_no: "1234567890", invoice_tax_office: "Kadıköy" }),
    "Yılmaz Otomotiv · VKN 1234567890 · Kadıköy V.D.");
  assert.equal(invoiceSummary({ invoice_type: "individual", invoice_company: null, invoice_tax_no: null, invoice_tax_office: null }), null);
  assert.equal(invoiceSummary({ invoice_type: null, invoice_company: null, invoice_tax_no: null, invoice_tax_office: null }), null);
});

const valid = { requestKey: randomUUID(), quote: "a".repeat(64), name: "Ayşe Yılmaz", email: "ayse@example.invalid", phone: "0555 123 45 67",
  province: "İstanbul", district: "Kadıköy", addressLine: "Caferağa Mah. Moda Cad. No 1", postalCode: "34710", note: "", invoiceType: "individual", consent: "on" };
const corporate = { ...valid, invoiceType: "corporate", invoiceCompany: "Yılmaz Otomotiv Ltd. Şti.", invoiceTaxNo: "1234567890", invoiceTaxOffice: "Kadıköy" };

test("the checkout input refuses an incomplete or inconsistent address or invoice", () => {
  const refused: [string, Record<string, unknown>][] = [
    ["no province", { ...valid, province: "" }],
    ["unknown province", { ...valid, province: "Istanbul" }],
    ["no district", { ...valid, district: "" }],
    ["another province's district", { ...valid, district: "Çankaya" }],
    ["short street address", { ...valid, addressLine: "Moda" }],
    ["long street address", { ...valid, addressLine: "x".repeat(501) }],
    ["four-digit postal code", { ...valid, postalCode: "3471" }],
    ["postal code of another province", { ...valid, postalCode: "06100" }],
    ["unknown invoice type", { ...valid, invoiceType: "other" }],
    ["corporate without title", { ...corporate, invoiceCompany: "" }],
    ["corporate with a nine-digit tax number", { ...corporate, invoiceTaxNo: "123456789" }],
    ["corporate with an eleven-digit tax number", { ...corporate, invoiceTaxNo: "12345678901" }],
    ["corporate with a non-numeric tax number", { ...corporate, invoiceTaxNo: "12345abcde" }],
    ["corporate without tax office", { ...corporate, invoiceTaxOffice: " " }],
    ["no consent", { ...valid, consent: undefined }],
  ];
  for (const [label, input] of refused) assert.equal(checkoutInput.safeParse(input).success, false, label);
});

test("the checkout input combines the address and drops what does not apply", () => {
  const individual = checkoutInput.parse({ ...valid, invoiceCompany: "Ignored", invoiceTaxNo: "1234567890", invoiceTaxOffice: "Ignored" });
  assert.equal(individual.address, "Caferağa Mah. Moda Cad. No 1, 34710 Kadıköy/İstanbul");
  assert.deepEqual([individual.province, individual.district, individual.addressLine, individual.postalCode], ["İstanbul", "Kadıköy", "Caferağa Mah. Moda Cad. No 1", "34710"]);
  assert.deepEqual([individual.invoiceType, individual.invoiceCompany, individual.invoiceTaxNo, individual.invoiceTaxOffice], ["individual", null, null, null]);

  const noPostal = checkoutInput.parse({ ...valid, postalCode: "" });
  assert.equal(noPostal.postalCode, null);
  assert.equal(noPostal.address, "Caferağa Mah. Moda Cad. No 1, Kadıköy/İstanbul");
  const withoutPostal: Record<string, unknown> = { ...valid };
  delete withoutPostal.postalCode;
  assert.equal(checkoutInput.parse(withoutPostal).postalCode, null);

  const business = checkoutInput.parse({ ...corporate, invoiceCompany: "  Yılmaz Otomotiv Ltd. Şti. " });
  assert.deepEqual([business.invoiceType, business.invoiceCompany, business.invoiceTaxNo, business.invoiceTaxOffice], ["corporate", "Yılmaz Otomotiv Ltd. Şti.", "1234567890", "Kadıköy"]);
  assert.equal(checkoutInput.safeParse({ ...valid, province: "Ankara", district: "Çankaya", postalCode: "06690" }).success, true);
});
