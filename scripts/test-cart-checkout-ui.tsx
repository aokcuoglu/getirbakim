import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CartActionBar } from "../src/components/cart-action-bar";
import { CheckoutSteps } from "../src/components/checkout-steps";
import { cartOrderable } from "../src/components/cart-orderable";
import { CheckoutAddressFields, CheckoutInvoiceFields } from "../src/components/checkout-address-fields";
import { CheckoutDeliveryFields } from "../src/components/checkout-delivery-fields";
import { checkoutCheckbox } from "../src/components/checkout-field-classes";
import { cn } from "../src/lib/utils";
import type { AccountAddress } from "../src/modules/store/account-addresses";
import type { CheckoutPrefill } from "../src/modules/store/checkout-prefill";

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

test("the checkout summary and its error alerts name the lines as the cart and the order do (#952)", async () => {
  // OrderSummary and the page read server-only modules, so their sources are checked: no raw supplier name is printed.
  const { readFile } = await import("node:fs/promises");
  const summary = await readFile(new URL("../src/components/order-summary.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/(store)/siparis-olustur/page.tsx", import.meta.url), "utf8");
  assert.match(summary, /\{shownProductName\(p\)\} \{p\.display_brand\}/);
  assert.doesNotMatch(summary, /\{p\.name\}/);
  assert.match(page, /items\.map\(p=>\[p\.id,shownProductName\(p\)\]\)/);
});

const saved = (id: string, label: string, flags: Partial<AccountAddress> = {}): AccountAddress => ({ id, label, recipient_name: `Alıcı ${label}`, phone: "0555 000 00 00", province: "Ankara",
  district: "Çankaya", address_line: `Atatürk Bulvarı No ${label}`, postal_code: null, default_delivery: false, default_invoice: false, ...flags });
const prefill = (over: Partial<CheckoutPrefill> = {}): CheckoutPrefill => ({ name: "Servis AŞ", phone: "0555 111 11 11", delivery: null, deliveryAddressId: null, invoiceAddressId: null, invoice: null, ...over });

test("the delivery fields without saved addresses have no picker and no save box for guests (#999)", () => {
  const html = renderToStaticMarkup(<CheckoutDeliveryFields prefill={prefill()} addresses={[]} canSave={false}/>);
  assert.match(html, /id="checkout-name"[^>]*value="Servis AŞ"/);
  assert.match(html, /id="checkout-email"/);
  assert.match(html, /id="checkout-phone"/);
  assert.doesNotMatch(html, /checkout-saved/);
  assert.doesNotMatch(html, /saveAddress/);
  assert.doesNotMatch(html, /Adreslerimi yönet/);
});

test("an account with saved addresses gets the picker with its default preselected and the save box when there is room (#999)", () => {
  const first = saved("11111111-1111-4111-8111-111111111111", "Merkez", { default_delivery: true });
  const second = saved("22222222-2222-4222-8222-222222222222", "Depo");
  const html = renderToStaticMarkup(<CheckoutDeliveryFields prefill={prefill({ deliveryAddressId: first.id, delivery: { province: "Ankara", district: "Çankaya", addressLine: first.address_line, postalCode: null } })}
    addresses={[first, second]} canSave manage/>);
  assert.match(html, /<label[^>]*for="checkout-saved"[^>]*>Kayıtlı adreslerim/);
  assert.match(html, /<option[^>]*value="11111111[^"]*" selected="">Merkez · Çankaya\/Ankara<\/option>/);
  assert.match(html, /<option[^>]*value="22222222[^"]*">Depo · Çankaya\/Ankara<\/option>/);
  assert.match(html, /<option[^>]*value="">Yeni adres gir<\/option>/);
  assert.doesNotMatch(html, /<select[^>]*name=/);
  assert.match(html, /role="status"/);
  assert.match(html, /name="saveAddress"/);
  assert.match(html, /Bu adresi adreslerime kaydet/);
  assert.doesNotMatch(html, /saveAddressLabel/);
  assert.match(html, /Adreslerimi yönet/);
  assert.match(html, /Atatürk Bulvarı No Merkez/);
  // Full address book: picker stays, no save box.
  assert.doesNotMatch(renderToStaticMarkup(<CheckoutDeliveryFields prefill={prefill()} addresses={[first]} canSave={false}/>), /saveAddress/);
  // Without a default the picker starts on "Yeni adres gir".
  assert.match(renderToStaticMarkup(<CheckoutDeliveryFields prefill={prefill()} addresses={[first]} canSave/>), /<option[^>]*value="" selected="">Yeni adres gir/);
});

test("the invoice picker sits only inside the separate invoice address block (#999)", () => {
  const address = saved("33333333-3333-4333-8333-333333333333", "Fatura");
  const html = renderToStaticMarkup(<CheckoutInvoiceFields addresses={[address]} selectedId={address.id}
    initial={{ invoiceType: "individual", company: null, taxNo: null, taxOffice: null, address: { province: "Ankara", district: "Çankaya", addressLine: address.address_line, postalCode: null } }}/>);
  const block = html.slice(html.indexOf('id="checkout-invoice-address"'));
  assert.ok(html.indexOf('id="checkout-invoice-saved"') > html.indexOf('id="checkout-invoice-address"'));
  assert.equal(html.match(/checkout-invoice-saved/g)?.length, 2);
  assert.ok(block.includes("checkout-invoice-saved"));
  assert.doesNotMatch(renderToStaticMarkup(<CheckoutInvoiceFields/>), /checkout-invoice-saved/);
});

test("checkboxes keep a 44px touch area over the stock checkbox classes (#999)", () => {
  const merged = cn("after:absolute after:-inset-x-3 after:-inset-y-2", checkoutCheckbox);
  assert.match(merged, /after:-inset-3/);
  assert.doesNotMatch(merged, /after:-inset-[xy]/);
});
