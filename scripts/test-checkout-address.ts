import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { checkoutErrorField, checkoutInput } from "../src/modules/store/checkout-schema";
import { addressProblem, composeAddress, districtsOf, findProvince, invoiceAddressText, invoiceSummary, matchName, postalCodeFits, provinces, validTaxId } from "../src/modules/store/tr-address";

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
    "Yılmaz Otomotiv · Vergi/TC kimlik no 1234567890 · Kadıköy V.D.");
  assert.equal(invoiceSummary({ invoice_type: "individual", invoice_company: null, invoice_tax_no: null, invoice_tax_office: null }), null);
  assert.equal(invoiceSummary({ invoice_type: null, invoice_company: null, invoice_tax_no: null, invoice_tax_office: null }), null);
});

test("an address's first problem: unknown province, another province's district, or a postal code of another province", () => {
  assert.equal(addressProblem({ province: "İstanbul", district: "Kadıköy", postalCode: "34710" }), null);
  assert.equal(addressProblem({ province: "İstanbul", district: "Kadıköy", postalCode: "" }), null);
  assert.equal(addressProblem({ province: "Istanbul", district: "Kadıköy", postalCode: "34710" }), "province");
  assert.equal(addressProblem({ province: "", district: "", postalCode: "" }), "province");
  assert.equal(addressProblem({ province: "İstanbul", district: "Çankaya", postalCode: "06100" }), "district");
  assert.equal(addressProblem({ province: "İstanbul", district: "", postalCode: "" }), "district");
  assert.equal(addressProblem({ province: "İstanbul", district: "Kadıköy", postalCode: "06100" }), "postalCode");
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
    ["corporate with a ten-digit number failing the VKN check digit", { ...corporate, invoiceTaxNo: "1234567891" }],
    ["corporate with an eleven-digit number failing the TC check digits", { ...corporate, invoiceTaxNo: "12345678901" }],
    ["corporate with an eleven-digit number starting with 0", { ...corporate, invoiceTaxNo: "01234567890" }],
    ["corporate with a twelve-digit tax number", { ...corporate, invoiceTaxNo: "123456789012" }],
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
  // A sole proprietor invoices with a valid 11-digit TC kimlik no (kept in the same column).
  const soleProprietor = checkoutInput.parse({ ...corporate, invoiceTaxNo: "10000000146" });
  assert.equal(soleProprietor.invoiceTaxNo, "10000000146");
  assert.equal(checkoutInput.parse({ ...valid, invoiceTaxNo: "10000000146" }).invoiceTaxNo, null);
});

test("the first refused field with its own message is reported, so the page can say what to fix", () => {
  const field = (input: Record<string, unknown>) => { const result = checkoutInput.safeParse(input); return result.success ? "ok" : checkoutErrorField(result.error.issues); };
  assert.equal(field({ ...valid, postalCode: "06100" }), "postalCode");
  assert.equal(field({ ...valid, district: "Çankaya" }), "district");
  assert.equal(field({ ...corporate, invoiceTaxNo: "123" }), "invoiceTaxNo");
  assert.equal(field({ ...valid, addressLine: "kısa" }), "addressLine");
  assert.equal(field({ ...valid, requestKey: "x" }), undefined);
  assert.equal(postalCodeFits("34710", findProvince("İstanbul")!), true);
  assert.equal(postalCodeFits("06100", findProvince("İstanbul")!), false);
  assert.equal(postalCodeFits("01100", findProvince("Adana")!), true);
});

const separate = { ...valid, invoiceAddressMode: "separate", invoiceProvince: "Ankara", invoiceDistrict: "Çankaya", invoiceAddressLine: "Atatürk Bulvarı No 1 Kat 3", invoicePostalCode: "06690" };

test("a separate invoice address is checked like the delivery address (#916)", () => {
  const refused: [string, Record<string, unknown>][] = [
    ["no invoice province", { ...separate, invoiceProvince: "" }],
    ["missing invoice province", { ...valid, invoiceAddressMode: "separate" }],
    ["unknown invoice province", { ...separate, invoiceProvince: "Ankra" }],
    ["another province's invoice district", { ...separate, invoiceDistrict: "Kadıköy" }],
    ["short invoice street address", { ...separate, invoiceAddressLine: "Bulvar" }],
    ["long invoice street address", { ...separate, invoiceAddressLine: "x".repeat(501) }],
    ["invoice postal code of another province", { ...separate, invoicePostalCode: "34710" }],
    ["four-digit invoice postal code", { ...separate, invoicePostalCode: "0669" }],
    ["unknown address mode", { ...separate, invoiceAddressMode: "other" }],
  ];
  for (const [label, input] of refused) assert.equal(checkoutInput.safeParse(input).success, false, label);
  const field = (input: Record<string, unknown>) => { const result = checkoutInput.safeParse(input); return result.success ? "ok" : checkoutErrorField(result.error.issues); };
  assert.equal(field({ ...separate, invoiceProvince: "Ankra" }), "invoiceProvince");
  assert.equal(field({ ...separate, invoiceDistrict: "Kadıköy" }), "invoiceDistrict");
  assert.equal(field({ ...separate, invoiceAddressLine: "Bulvar" }), "invoiceAddressLine");
  assert.equal(field({ ...separate, invoicePostalCode: "34710" }), "invoicePostalCode");
});

test("the invoice address is null unless a separate one is chosen, and then has no form fields left over", () => {
  assert.equal(checkoutInput.parse(valid).invoiceAddress, null);
  // "same" ignores whatever invoice address fields were submitted, even invalid ones.
  const same = checkoutInput.parse({ ...separate, invoiceAddressMode: "same", invoiceDistrict: "Kadıköy" });
  assert.equal(same.invoiceAddress, null);
  // Only the format checks still apply in "same" mode; the form does not submit the hidden block at all.
  assert.equal(checkoutInput.safeParse({ ...valid, invoiceAddressLine: "x".repeat(501) }).success, false);
  const parsed = checkoutInput.parse(separate);
  assert.deepEqual(parsed.invoiceAddress, { province: "Ankara", district: "Çankaya", addressLine: "Atatürk Bulvarı No 1 Kat 3", postalCode: "06690" });
  for (const key of ["invoiceAddressMode", "invoiceProvince", "invoiceDistrict", "invoiceAddressLine", "invoicePostalCode"]) assert.equal(Object.hasOwn(parsed, key), false, key);
  assert.equal(checkoutInput.parse({ ...separate, invoicePostalCode: "" }).invoiceAddress?.postalCode, null);
  // Allowed with a corporate invoice too.
  assert.equal(checkoutInput.parse({ ...corporate, ...separate, invoiceType: "corporate" }).invoiceAddress?.province, "Ankara");
});

test("the invoice address text is null for the delivery address and composed for a separate one", () => {
  assert.equal(invoiceAddressText({ invoice_province: null, invoice_district: null, invoice_address_line: null, invoice_postal_code: null }), null);
  assert.equal(invoiceAddressText({ invoice_province: "Ankara", invoice_district: "Çankaya", invoice_address_line: "Atatürk Bulvarı No 1", invoice_postal_code: "06690" }),
    "Atatürk Bulvarı No 1, 06690 Çankaya/Ankara");
  assert.equal(invoiceAddressText({ invoice_province: "Ankara", invoice_district: "Çankaya", invoice_address_line: "Atatürk Bulvarı No 1", invoice_postal_code: null }),
    "Atatürk Bulvarı No 1, Çankaya/Ankara");
});

test("a corporate tax id is a 10-digit VKN or an 11-digit TC kimlik no that passes its check digits", () => {
  for (const id of [
    "1234567890", "0000000001", "1000000000", "9999999994", "4710000005", // VKN
    "10000000146", "12345678950", "11111111110", // TC kimlik no
  ]) assert.equal(validTaxId(id), true, id);
  for (const id of [
    "123456789", "123456789012", "12345abcde", "", " 1234567890",
    "0000000000", "1234567891", "9999999999", // VKN check digit wrong
    "10000000147", // 11th digit wrong
    "10000000156", // 10th digit wrong (11th recomputed: 1+5=6)
    "01234567890", // starts with 0
    "00000000000",
  ]) assert.equal(validTaxId(id), false, id);
  // Each single-digit change of a valid VKN or TC kimlik no in its check digits is refused.
  for (let digit = 0; digit <= 9; digit++) {
    if (digit !== 0) assert.equal(validTaxId(`123456789${digit}`), false, `VKN ${digit}`);
    if (digit !== 4) assert.equal(validTaxId(`100000001${digit}6`), false, `10th ${digit}`);
    if (digit !== 6) assert.equal(validTaxId(`1000000014${digit}`), false, `11th ${digit}`);
  }
});
