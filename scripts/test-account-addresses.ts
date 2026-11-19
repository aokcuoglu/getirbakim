import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { addressErrorField, addressFieldErrors, addressInput, addressKey } from "../src/modules/store/address-schema";
import { checkoutPrefill } from "../src/modules/store/checkout-prefill";
import type { AccountAddress } from "../src/modules/store/account-addresses";
import type { CheckoutDetails } from "../src/modules/store/orders";
import { isolatedSchema } from "./isolated-schema";

// Saved address book of approved accounts (#950): schema and rules in an isolated schema; cookies are an in-memory jar
// standing in for the Server Action request.
const cookieStore = new Map<string, string>();
const jar = { get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined), set: () => {}, delete: () => {} };
mock.module("next/headers", { namedExports: { cookies: async () => jar, headers: async () => new Headers() } });
mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });

const valid = { label: "Servis", recipientName: "Ayşe Yılmaz", phone: "0555 123 45 67", province: "İstanbul", district: "Kadıköy",
  addressLine: "Caferağa Mah. Moda Cad. No 1", postalCode: "34710" };

test("the address input accepts a complete address and refuses an incomplete or inconsistent one", () => {
  const accepted = addressInput.parse({ ...valid, label: "  Depo  ", defaultDelivery: "on" });
  assert.deepEqual(accepted, { ...valid, label: "Depo", defaultDelivery: true, defaultInvoice: false });
  assert.equal(addressInput.parse({ ...valid, postalCode: "" }).postalCode, null);
  assert.equal(addressInput.parse({ label: valid.label, recipientName: valid.recipientName, phone: valid.phone, province: valid.province,
    district: valid.district, addressLine: valid.addressLine }).postalCode, null);
  const refused: [string, Record<string, unknown>, string][] = [
    ["empty label", { ...valid, label: "  " }, "label"],
    ["long label", { ...valid, label: "x".repeat(61) }, "label"],
    ["short recipient", { ...valid, recipientName: "A" }, "recipientName"],
    ["bad phone", { ...valid, phone: "12ab" }, "phone"],
    ["unknown province", { ...valid, province: "Istanbul" }, "province"],
    ["another province's district", { ...valid, district: "Çankaya" }, "district"],
    ["short street address", { ...valid, addressLine: "Moda" }, "addressLine"],
    ["four-digit postal code", { ...valid, postalCode: "3471" }, "postalCode"],
    ["postal code of another province", { ...valid, postalCode: "06100" }, "postalCode"],
    ["box with another value", { ...valid, defaultInvoice: "yes" }, ""],
  ];
  for (const [name, input, field] of refused) {
    const result = addressInput.safeParse(input);
    assert.equal(result.success, false, name);
    if (field) assert.equal(addressErrorField(result.error!.issues), field, name);
  }
});

const row = (id: string, flags: Partial<AccountAddress> = {}): AccountAddress => ({ id, label: id, recipient_name: `Alıcı ${id}`, phone: `0555 000 00 0${id.length}`,
  province: "Ankara", district: "Çankaya", address_line: `Atatürk Bulvarı No ${id}`, postal_code: null, default_delivery: false, default_invoice: false, ...flags });
const last: CheckoutDetails = { phone: "0555 111 11 11", delivery_province: "İstanbul", delivery_district: "Kadıköy", delivery_address_line: "Moda Cad. No 1", delivery_postal_code: "34710",
  invoice_type: "corporate", invoice_company: "Yılmaz Otomotiv", invoice_tax_no: "1234567890", invoice_tax_office: "Kadıköy",
  invoice_province: "İzmir", invoice_district: "Konak", invoice_address_line: "Fatura Sok. No 2", invoice_postal_code: null };
const identity = { invoiceType: "corporate", company: "Yılmaz Otomotiv", taxNo: "1234567890", taxOffice: "Kadıköy" } as const;
const lastInvoice = { province: "İzmir", district: "Konak", addressLine: "Fatura Sok. No 2", postalCode: null };

test("the checkout starts from the default addresses ahead of the account name and the latest order", () => {
  const account = { name: "Servis AŞ" };
  // Guest or new account: nothing saved, nothing ordered.
  assert.deepEqual(checkoutPrefill(null, null, null), { name: undefined, phone: undefined, delivery: null, deliveryAddressId: null, invoiceAddressId: null, invoice: null });
  assert.deepEqual(checkoutPrefill(account, { delivery: null, invoice: null }, null), { name: "Servis AŞ", phone: undefined, delivery: null, deliveryAddressId: null, invoiceAddressId: null, invoice: null });
  // No defaults: the latest order fills everything (#881).
  assert.deepEqual(checkoutPrefill(account, { delivery: null, invoice: null }, last), {
    name: "Servis AŞ", phone: last.phone, delivery: { province: "İstanbul", district: "Kadıköy", addressLine: "Moda Cad. No 1", postalCode: "34710" },
    deliveryAddressId: null, invoiceAddressId: null, invoice: { ...identity, address: lastInvoice },
  });
  // One row both defaults: its recipient, phone and address; the invoice goes to the delivery address, identity from the order.
  const both = row("a", { default_delivery: true, default_invoice: true, postal_code: "06100" });
  assert.deepEqual(checkoutPrefill(account, { delivery: both, invoice: both }, last), {
    name: "Alıcı a", phone: both.phone, delivery: { province: "Ankara", district: "Çankaya", addressLine: "Atatürk Bulvarı No a", postalCode: "06100" },
    deliveryAddressId: "a", invoiceAddressId: null, invoice: { ...identity, address: null },
  });
  // Separate default invoice row.
  const delivery = row("a", { default_delivery: true }), invoice = row("bb", { default_invoice: true });
  const separate = checkoutPrefill(account, { delivery, invoice }, null);
  assert.equal(separate.name, "Alıcı a");
  assert.deepEqual(separate.invoice, { invoiceType: null, company: null, taxNo: null, taxOffice: null,
    address: { province: "Ankara", district: "Çankaya", addressLine: "Atatürk Bulvarı No bb", postalCode: null } });
  // Only a default invoice address: delivery, name and phone from the account and the order.
  const invoiceOnly = checkoutPrefill(account, { delivery: null, invoice }, last);
  assert.equal(invoiceOnly.name, "Servis AŞ");
  assert.equal(invoiceOnly.phone, last.phone);
  assert.equal(invoiceOnly.delivery?.province, "İstanbul");
  assert.equal(invoiceOnly.invoice?.address?.addressLine, "Atatürk Bulvarı No bb");
  // Only a default delivery address: the invoice address still from the order.
  assert.deepEqual(checkoutPrefill(account, { delivery, invoice: null }, last).invoice, { ...identity, address: lastInvoice });
});

test("the address key ignores case and punctuation, with Turkish case rules", () => {
  const key = (province: string, district: string, addressLine: string) => addressKey({ province, district, addressLine });
  assert.equal(key("İstanbul", "Kadıköy", "Moda Cad. No:1"), "istanbul|kadıköy|moda cad no:1");
  assert.equal(key("İSTANBUL", "KADIKÖY", "  MODA   CAD., NO:1 "), key("İstanbul", "Kadıköy", "Moda Cad. No:1"));
  assert.equal(key("Iğdır", "Merkez", "A-B/C"), "ığdır|merkez|a b c");
  assert.notEqual(key("Iğdır", "Merkez", "x"), key("İğdır", "Merkez", "x"));
  assert.notEqual(key("Ankara", "Çankaya", "No 1"), key("Ankara", "Çankaya", "No 2"));
});

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let book: typeof import("../src/modules/store/account-addresses");
let actions: typeof import("../src/app/(store)/hesap/adresler/actions");
let closeDb: () => Promise<void>;
let accountId = "", otherId = "";
const newAccount = async (email: string, approved = true) =>
  (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('T',$1,'x','service',$2) RETURNING id", [email, approved])).rows[0].id;
const input = (overrides: Partial<ReturnType<typeof addressInput.parse>> = {}) => ({ ...addressInput.parse(valid), ...overrides });
const flags = async (account: string) => (await schema.pool.query<{ label: string; default_delivery: boolean; default_invoice: boolean }>(
  "SELECT label,default_delivery,default_invoice FROM account_addresses WHERE account_id=$1 ORDER BY created_at,id", [account])).rows;
const signIn = async (account: string) => {
  const token = randomUUID();
  await schema.pool.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [createHash("sha256").update(token).digest("hex"), account]);
  cookieStore.set("gb_session", token);
};
const redirected = async (action: Promise<unknown>) => {
  try { await action; } catch (error) { const match = /^NEXT_REDIRECT (.*)$/.exec((error as Error).message); if (match) return match[1]; throw error; }
  assert.fail("expected a redirect");
};
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };

before(async () => {
  schema = await isolatedSchema("account_addresses_test");
  accountId = await newAccount("book@example.invalid");
  otherId = await newAccount("other@example.invalid");
  const [{ db }, b, a] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/account-addresses"), import("../src/app/(store)/hesap/adresler/actions")]);
  book = b; actions = a; closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });
beforeEach(async () => { cookieStore.clear(); await schema.pool.query("DELETE FROM account_addresses"); });

test("the first address becomes both defaults; a later one takes a default it asks for", async () => {
  const first = await book.createAddress(accountId, input({ label: "Merkez" }));
  assert.ok("id" in first);
  await book.createAddress(accountId, input({ label: "Depo" }));
  assert.deepEqual(await flags(accountId), [{ label: "Merkez", default_delivery: true, default_invoice: true }, { label: "Depo", default_delivery: false, default_invoice: false }]);
  await book.createAddress(accountId, input({ label: "Şube", defaultInvoice: true }));
  assert.deepEqual((await flags(accountId)).map(row => [row.label, row.default_delivery, row.default_invoice]),
    [["Merkez", true, false], ["Depo", false, false], ["Şube", false, true]]);
  const defaults = await book.defaultAddresses(accountId);
  assert.equal(defaults.delivery?.label, "Merkez");
  assert.equal(defaults.invoice?.label, "Şube");
  assert.deepEqual((await book.listAddresses(accountId)).map(row => row.label), ["Merkez", "Depo", "Şube"]);
});

test("making an address the default moves the flag without a unique violation; deleting a default leaves none", async () => {
  const a = await book.createAddress(accountId, input({ label: "A" })), b = await book.createAddress(accountId, input({ label: "B" }));
  assert.ok("id" in a && "id" in b);
  assert.equal(await book.setDefaultAddress(accountId, b.id, "delivery"), true);
  assert.deepEqual((await flags(accountId)).map(row => [row.label, row.default_delivery, row.default_invoice]), [["A", false, true], ["B", true, false]]);
  assert.equal(await book.setDefaultAddress(accountId, b.id, "invoice"), true);
  assert.equal(await book.setDefaultAddress(accountId, b.id, "invoice"), true);
  assert.deepEqual((await flags(accountId)).map(row => [row.label, row.default_delivery, row.default_invoice]), [["A", false, false], ["B", true, true]]);
  // An edit asking for the default moves it; an unticked box keeps the current one.
  assert.equal(await book.updateAddress(accountId, a.id, input({ label: "A2", defaultDelivery: true })), true);
  assert.equal(await book.updateAddress(accountId, b.id, input({ label: "B2" })), true);
  assert.deepEqual((await flags(accountId)).map(row => [row.label, row.default_delivery, row.default_invoice]), [["A2", true, false], ["B2", false, true]]);
  // Concurrent moves between the two rows end with one default each.
  await Promise.all([book.setDefaultAddress(accountId, a.id, "invoice"), book.setDefaultAddress(accountId, b.id, "invoice"),
    book.setDefaultAddress(accountId, b.id, "delivery"), book.setDefaultAddress(accountId, a.id, "delivery")]);
  const rows = await flags(accountId);
  assert.equal(rows.filter(row => row.default_delivery).length, 1);
  assert.equal(rows.filter(row => row.default_invoice).length, 1);
  assert.equal(await book.deleteAddress(accountId, a.id), true);
  assert.equal(await book.deleteAddress(accountId, b.id), true);
  assert.deepEqual(await book.defaultAddresses(accountId), { delivery: null, invoice: null });
});

test("an account keeps at most ADDRESS_LIMIT addresses, also when saved at once", async () => {
  const results = await Promise.all(Array.from({ length: book.ADDRESS_LIMIT + 1 }, (_, i) => book.createAddress(accountId, input({ label: `Adres ${i}` }))));
  assert.equal(results.filter(result => "error" in result && result.error === "limit").length, 1);
  assert.equal((await book.listAddresses(accountId)).length, book.ADDRESS_LIMIT);
  assert.deepEqual(await book.createAddress(accountId, input()), { error: "limit" });
  const rows = await flags(accountId);
  assert.equal(rows.filter(row => row.default_delivery).length, 1);
  assert.equal(rows.filter(row => row.default_invoice).length, 1);
});

test("another account's address can be neither read nor changed", async () => {
  const mine = await book.createAddress(accountId, input({ label: "Benim" }));
  assert.ok("id" in mine);
  await book.createAddress(otherId, input({ label: "Onun" }));
  const before = await flags(accountId);
  assert.equal(await book.getAddress(otherId, mine.id), null);
  assert.equal(await book.updateAddress(otherId, mine.id, input({ label: "Ele geçirildi" })), false);
  assert.equal(await book.setDefaultAddress(otherId, mine.id, "delivery"), false);
  assert.equal(await book.deleteAddress(otherId, mine.id), false);
  assert.deepEqual(await flags(accountId), before);
  assert.deepEqual((await flags(otherId)).map(row => [row.label, row.default_delivery, row.default_invoice]), [["Onun", true, true]]);
  assert.equal(await book.getAddress(accountId, randomUUID()), null);
});

test("deleting an account deletes its addresses", async () => {
  const gone = await newAccount("gone@example.invalid");
  await book.createAddress(gone, input());
  await schema.pool.query("DELETE FROM accounts WHERE id=$1", [gone]);
  assert.equal(Number((await schema.pool.query<{ count: string }>("SELECT count(*) FROM account_addresses WHERE account_id=$1", [gone])).rows[0].count), 0);
});

test("the page's actions need an approved account and act only on its own addresses", async () => {
  const fields = { ...valid, defaultDelivery: "on" };
  assert.equal(await redirected(actions.saveAddress(null, form(fields))), "/giris?next=%2Fhesap%2Fadresler");
  await signIn(await newAccount("pending@example.invalid", false));
  assert.equal(await redirected(actions.saveAddress(null, form(fields))), "/giris?next=%2Fhesap%2Fadresler");
  await signIn(accountId);
  assert.equal(await redirected(actions.saveAddress(null, form(fields))), "/hesap/adresler?saved=1");
  // A refusal returns its message with what was typed, so the form keeps it; nothing is stored.
  const refused = await actions.saveAddress(null, form({ ...fields, district: "Çankaya" }));
  assert.deepEqual(refused, { error: addressFieldErrors.district, attempt: 1,
    values: { ...valid, district: "Çankaya", defaultDelivery: "on", defaultInvoice: "" } });
  assert.equal((await actions.saveAddress(refused, form({ ...fields, label: "" })))?.attempt, 2);
  const [saved] = await book.listAddresses(accountId);
  assert.equal((await book.listAddresses(accountId)).length, 1);
  assert.equal((await actions.saveAddress(null, form({ ...fields, id: saved.id, label: "" })))?.error, addressFieldErrors.label);
  assert.equal(await redirected(actions.saveAddress(null, form({ ...fields, id: saved.id, label: "Yeni ad" }))), "/hesap/adresler?saved=1");
  assert.equal((await book.getAddress(accountId, saved.id))?.label, "Yeni ad");
  const theirs = await book.createAddress(otherId, input({ label: "Onun" }));
  assert.ok("id" in theirs);
  assert.equal((await actions.saveAddress(null, form({ ...fields, id: theirs.id })))?.error, "Adres bulunamadı. Sayfayı yenileyip yeniden dene.");
  assert.equal((await actions.saveAddress(null, form({ ...fields, id: "not-a-uuid" })))?.error, "Adres bulunamadı. Sayfayı yenileyip yeniden dene.");
  assert.equal(await redirected(actions.removeAddress(form({ id: theirs.id }))), "/hesap/adresler?error=missing");
  assert.equal(await redirected(actions.makeDefault(form({ id: theirs.id, kind: "delivery" }))), "/hesap/adresler?error=missing");
  assert.equal(await redirected(actions.makeDefault(form({ id: saved.id, kind: "other" }))), "/hesap/adresler?error=missing");
  assert.equal(await redirected(actions.removeAddress(form({ id: "not-a-uuid" }))), "/hesap/adresler?error=missing");
  assert.equal((await book.getAddress(otherId, theirs.id))?.label, "Onun");
  assert.equal(await redirected(actions.makeDefault(form({ id: saved.id, kind: "delivery" }))), "/hesap/adresler?default=1");
  assert.equal(await redirected(actions.removeAddress(form({ id: saved.id }))), "/hesap/adresler?removed=1");
  assert.deepEqual(await book.listAddresses(accountId), []);
});

test("a full address book refuses a new address in the form", async () => {
  await signIn(accountId);
  for (let i = 0; i < book.ADDRESS_LIMIT; i++) await book.createAddress(accountId, input({ label: `Adres ${i}` }));
  assert.equal((await actions.saveAddress(null, form(valid)))?.error, addressFieldErrors.limit);
});

test("the phone is 10 to 20 characters in the form and in the table", async () => {
  const twenty = "+" + "5".repeat(19), long = "+" + "5".repeat(20);
  assert.equal(addressInput.safeParse({ ...valid, phone: twenty }).success, true);
  assert.equal(addressInput.safeParse({ ...valid, phone: "5".repeat(10) }).success, true);
  assert.equal(addressInput.safeParse({ ...valid, phone: long }).success, false);
  assert.equal(addressInput.safeParse({ ...valid, phone: "5".repeat(9) }).success, false);
  assert.ok("id" in await book.createAddress(accountId, input({ phone: twenty })));
  assert.ok("id" in await book.createAddress(accountId, input({ phone: "5".repeat(10) })));
  await assert.rejects(book.createAddress(accountId, input({ phone: long })), { code: "23514" });
});

const checkout = { name: "Ayşe Yılmaz", phone: "0555 123 45 67", province: "İstanbul", district: "Kadıköy", addressLine: "Caferağa Mah. Moda Cad. No 1", postalCode: "34710" as string | null, saveAddressLabel: "" };

test("a placed order's address is saved once, with the first one default and a default label", async () => {
  const owner = { kind: "account", id: accountId };
  assert.equal(await book.saveCheckoutAddress(owner, checkout), "saved");
  const [saved] = (await schema.pool.query<{ label: string; recipient_name: string; default_delivery: boolean; default_invoice: boolean; postal_code: string | null }>(
    "SELECT label,recipient_name,default_delivery,default_invoice,postal_code FROM account_addresses WHERE account_id=$1", [accountId])).rows;
  assert.deepEqual(saved, { label: "Kadıköy / İstanbul", recipient_name: "Ayşe Yılmaz", default_delivery: true, default_invoice: true, postal_code: "34710" });
  // Same address with other case and punctuation is a duplicate; nothing is written.
  assert.equal(await book.saveCheckoutAddress(owner, { ...checkout, addressLine: "CAFERAĞA MAH, MODA CAD. NO 1", saveAddressLabel: "Başka" }), "duplicate");
  // A later address takes no default and the label it was given; defaults of the first stay.
  assert.equal(await book.saveCheckoutAddress(owner, { ...checkout, addressLine: "Başka Mah. Başka Cad. No 9", saveAddressLabel: "Depo", postalCode: null }), "saved");
  assert.deepEqual((await flags(accountId)).map(row => [row.label, row.default_delivery, row.default_invoice]), [["Kadıköy / İstanbul", true, true], ["Depo", false, false]]);
});

test("saving the order's address is skipped for guests and invalid candidates, refused when the book is full, and never throws", async () => {
  assert.equal(await book.saveCheckoutAddress({ kind: "guest", id: randomUUID() }, checkout), "skipped");
  const owner = { kind: "account", id: accountId };
  // The checkout phone allows 21 characters, the address book 20.
  assert.equal(await book.saveCheckoutAddress(owner, { ...checkout, phone: "+" + "5".repeat(20) }), "skipped");
  assert.equal(await book.saveCheckoutAddress(owner, { ...checkout, saveAddressLabel: "x".repeat(61) }), "skipped");
  assert.deepEqual(await flags(accountId), []);
  for (let i = 0; i < book.ADDRESS_LIMIT; i++) await book.createAddress(accountId, input({ label: `Adres ${i}`, addressLine: `Moda Cad. No ${i + 10}` }));
  assert.equal(await book.saveCheckoutAddress(owner, checkout), "limit");
  assert.equal((await flags(accountId)).length, book.ADDRESS_LIMIT);
  // An id that is not a uuid makes the query fail: still no throw.
  const error = mock.method(console, "error", () => {});
  assert.equal(await book.saveCheckoutAddress({ kind: "account", id: "not-a-uuid" }, checkout), "skipped");
  assert.equal(error.mock.callCount(), 1);
  error.mock.restore();
});
