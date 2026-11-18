import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CartActionBar } from "../src/components/cart-action-bar";
import { CheckoutSteps } from "../src/components/checkout-steps";
import { cartOrderable } from "../src/components/cart-orderable";
import { CheckoutAddressFields, CheckoutInvoiceFields } from "../src/components/checkout-address-fields";

test("the phone cart bar shows the total and links to checkout, sticky and clear of the home indicator (#877)", () => {
  const html = renderToStaticMarkup(<CartActionBar total="1.250,00 ₺" valid/>);
  assert.match(html, /1\.250,00 ₺/);
  assert.match(html, /href="\/siparis-olustur"/);
  assert.match(html, /sticky bottom-0/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /min-h-12/);
  assert.match(html, /min-\[761px\]:hidden/);
});

test("an unavailable line disables the bar's action and points to the warning", () => {
  const html = renderToStaticMarkup(<CartActionBar total="10,00 ₺" valid={false}/>);
  assert.doesNotMatch(html, /href="\/siparis-olustur"/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-describedby="cart-bar-invalid"/);
});

test("the checkout steps keep three steps, the current one marked, and shrink at 320px", () => {
  const html = renderToStaticMarkup(<CheckoutSteps/>);
  assert.equal(html.match(/<li/g)?.length, 3);
  assert.match(html, /aria-current="step"[^>]*>.*?Teslimat/);
  assert.match(html, /href="\/sepet"/);
  assert.match(html, /max-\[380px\]:size-6/);
  assert.match(html, /max-\[380px\]:not-last:after:hidden/);
});

test("one orderable rule: a discounted, under-threshold cart with an unavailable, priceless or oversized line is not orderable", () => {
  const line = { available: true, price_kurus: 10000, quantity: 2, max_quantity: 5 };
  assert.equal(cartOrderable([line, { ...line, quantity: 5 }]), true);
  assert.equal(cartOrderable([line, { ...line, available: false }]), false);
  assert.equal(cartOrderable([line, { ...line, price_kurus: 0 }]), false);
  assert.equal(cartOrderable([line, { ...line, quantity: 6 }]), false);
  assert.equal(cartOrderable([]), true);
});

test("an invalid cart's bar names the problem next to the disabled action", () => {
  const html = renderToStaticMarkup(<CartActionBar total="10,00 ₺" valid={false}/>);
  assert.match(html, /id="cart-bar-invalid"[^>]*>Uygun olmayan ürünler var/);
  assert.match(html, /text-destructive/);
});

test("the completed cart step is announced", () => {
  assert.match(renderToStaticMarkup(<CheckoutSteps/>), /\(tamamlandı\)/);
});

test("the checkout address asks for province, district, street address and postal code with browser autofill hints (#881)", () => {
  const html = renderToStaticMarkup(<CheckoutAddressFields/>);
  for (const name of ["province", "district", "addressLine", "postalCode"]) assert.match(html, new RegExp(`name="${name}"`), name);
  for (const hint of ["address-level1", "address-level2", "street-address", "postal-code"]) assert.match(html, new RegExp(`autoComplete="${hint}"`, "i"), hint);
  assert.doesNotMatch(html, /name="address"/);
  assert.match(html, /inputMode="numeric"[^>]*pattern="\\d\{5\}"|pattern="\\d\{5\}"[^>]*inputMode="numeric"/i);
  // Without a province the district cannot be chosen.
  assert.match(html, /<input[^>]*id="checkout-district"[^>]*disabled=""|<input[^>]*disabled=""[^>]*id="checkout-district"/);
  assert.match(html, /Önce il seç/);
  // The hints stay visible: the district's under its label while it is disabled, the postal code's format under the field.
  assert.match(html, /id="checkout-district-hint"[^>]*>Önce il seç\./);
  assert.match(html, /aria-describedby="checkout-district-hint"/);
  assert.match(html, /title="5 haneli posta kodu"/);
  assert.match(html, /id="checkout-postal-code-hint"[^>]*>5 haneli</);
  // The visible boxes carry the autofill hints too, not only the submitted hidden inputs.
  for (const [id, hint] of [["checkout-province", "address-level1"], ["checkout-district", "address-level2"]])
    assert.match(html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? "", new RegExp(`autoComplete="${hint}"`, "i"), id);
  assert.match(html, /grid-cols-2[^"]*max-\[480px\]:grid-cols-1/);
});

test("a saved address outside the lists starts empty; a valid one fills the fields", () => {
  const filled = renderToStaticMarkup(<CheckoutAddressFields initial={{ province: "İstanbul", district: "Kadıköy", addressLine: "Moda Cad. No 1", postalCode: "34710" }}/>);
  assert.match(filled, /value="İstanbul"/); assert.match(filled, /value="Kadıköy"/); assert.match(filled, /Moda Cad\. No 1/); assert.match(filled, /value="34710"/);
  assert.doesNotMatch(filled, /<input[^>]*id="checkout-district"[^>]*disabled=""/);
  const stale = renderToStaticMarkup(<CheckoutAddressFields initial={{ province: "Istanbul", district: "Kadıköy", addressLine: null, postalCode: null }}/>);
  assert.doesNotMatch(stale, /value="Istanbul"|value="Kadıköy"/);
});

test("the invoice is individual by default with no tax fields; corporate asks for title, VKN or TC kimlik no and tax office", () => {
  const individual = renderToStaticMarkup(<CheckoutInvoiceFields/>);
  assert.match(individual, /Bireysel/); assert.match(individual, /Kurumsal/);
  assert.match(individual, /name="invoiceType"[^>]*value="individual"|value="individual"[^>]*name="invoiceType"/);
  for (const name of ["invoiceCompany", "invoiceTaxNo", "invoiceTaxOffice"]) assert.doesNotMatch(individual, new RegExp(`name="${name}"`), name);
  const corporate = renderToStaticMarkup(<CheckoutInvoiceFields initial={{ invoiceType: "corporate", company: "Yılmaz Otomotiv", taxNo: "1234567890", taxOffice: "Kadıköy" }}/>);
  const inputTag = (name: string) => corporate.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
  for (const name of ["invoiceCompany", "invoiceTaxNo", "invoiceTaxOffice"]) assert.match(inputTag(name), /required=""/, name);
  assert.match(corporate, /autoComplete="organization"/i);
  assert.match(corporate, /pattern="\\d\{10,11\}"/);
  assert.match(corporate, /value="1234567890"/);
  assert.match(corporate, /Vergi kimlik no \/ TC kimlik no/);
  assert.match(corporate, /title="Şirketler için 10 haneli VKN, şahıs işletmeleri için 11 haneli TC kimlik no"/);
  assert.match(corporate, />Şirketler için 10 haneli VKN, şahıs işletmeleri için 11 haneli TC kimlik no</);
  assert.match(inputTag("invoiceTaxNo"), /maxLength="11"/i);
  assert.equal(individual.match(/min-h-11/g)?.length, 4);
  // An individual invoice asks for no identity number at all.
  assert.doesNotMatch(individual, /kimlik|VKN|T\.C\./i);
});

test("the invoice goes to the delivery address by default; a saved separate one shows its own billing fields (#916)", () => {
  const block = (html: string) => html.match(/<fieldset[^>]*id="checkout-invoice-address"[^>]*>[\s\S]*?<\/fieldset>/)?.[0] ?? "";
  const blockTag = (html: string) => html.match(/<fieldset[^>]*id="checkout-invoice-address"[^>]*>/)?.[0] ?? "";
  const checkbox = (html: string) => html.match(/<[^>]*role="checkbox"[^>]*>/)?.[0] ?? "";
  const same = renderToStaticMarkup(<CheckoutInvoiceFields/>);
  assert.match(same, /name="invoiceAddressMode"[^>]*value="same"|value="same"[^>]*name="invoiceAddressMode"/);
  assert.match(same, /Fatura adresi teslimat adresiyle aynı/);
  // The address has its own fieldset, apart from the invoice type, and the box points to the block it shows.
  assert.match(same, /<legend[^>]*>Fatura türü<\/legend>[\s\S]*<\/fieldset><fieldset[^>]*><legend[^>]*>Fatura adresi<\/legend>/);
  assert.match(checkbox(same), /aria-controls="checkout-invoice-address"/);
  assert.match(checkbox(same), /aria-expanded="false"/);
  // Ticked: the block stays mounted (what was typed survives) but is hidden and disabled, so nothing is submitted or checked.
  assert.match(blockTag(same), /hidden=""/); assert.match(blockTag(same), /disabled=""/);
  for (const name of ["invoiceProvince", "invoiceDistrict", "invoiceAddressLine", "invoicePostalCode"]) {
    assert.match(block(same), new RegExp(`name="${name}"`), name);
    assert.equal(same.match(new RegExp(`name="${name}"`, "g"))?.length, block(same).match(new RegExp(`name="${name}"`, "g"))?.length, `${name} only inside the block`);
  }

  const separate = renderToStaticMarkup(<CheckoutInvoiceFields initial={{ invoiceType: "individual", company: null, taxNo: null, taxOffice: null,
    address: { province: "Ankara", district: "Çankaya", addressLine: "Atatürk Bulvarı No 1", postalCode: "06690" } }}/>);
  assert.match(separate, /name="invoiceAddressMode"[^>]*value="separate"|value="separate"[^>]*name="invoiceAddressMode"/);
  assert.doesNotMatch(blockTag(separate), /hidden=""|disabled=""/);
  assert.match(checkbox(separate), /aria-expanded="true"/);
  for (const name of ["invoiceProvince", "invoiceDistrict", "invoiceAddressLine", "invoicePostalCode"]) assert.match(block(separate), new RegExp(`name="${name}"`), name);
  for (const hint of ["billing address-level1", "billing address-level2", "billing street-address", "billing postal-code"]) assert.match(separate, new RegExp(`autoComplete="${hint}"`, "i"), hint);
  for (const id of ["checkout-invoice-province", "checkout-invoice-district", "checkout-invoice-address-line", "checkout-invoice-postal-code"]) assert.match(separate, new RegExp(`id="${id}"`), id);
  assert.match(separate, /value="Ankara"/); assert.match(separate, /value="Çankaya"/); assert.match(separate, /value="06690"/);
  // No delivery names or ids inside the invoice block, so the page has no clashes.
  assert.doesNotMatch(separate, /name="(province|district|addressLine|postalCode)"|id="checkout-(province|district|address-line|postal-code)"/);
  const page = renderToStaticMarkup(<><CheckoutAddressFields/><CheckoutInvoiceFields initial={{ invoiceType: null, company: null, taxNo: null, taxOffice: null,
    address: { province: "Ankara", district: null, addressLine: null, postalCode: null } }}/></>);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, ids.join(" "));
  // A saved address without a province keeps the box ticked.
  assert.match(renderToStaticMarkup(<CheckoutInvoiceFields initial={{ invoiceType: "individual", company: null, taxNo: null, taxOffice: null,
    address: { province: null, district: null, addressLine: null, postalCode: null } }}/>), /value="same"/);
});
