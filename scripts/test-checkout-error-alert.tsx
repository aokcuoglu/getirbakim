import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutErrorAlert, cartLineNames } from "../src/components/checkout-error-alert";

const errors = { stock: "Genel stok metni.", price: "Genel fiyat metni.", supplier: "Tedarikçi metni." };
const lineNames = { a: "Yağ filtresi $& <b>", b: "Hava filtresi, büyük" };

test("only ids of the cart's lines are named, once each, by their cart names (#788)", () => {
  assert.deepEqual(cartLineNames(["a", "x", "a", "b", "constructor"], lineNames), ["Yağ filtresi $& <b>", "Hava filtresi, büyük"]);
  assert.deepEqual(cartLineNames([""], lineNames), []);
});

test("refused lines are listed under a count-neutral title; names are text, never markup or patterns", () => {
  const stock = renderToStaticMarkup(<CheckoutErrorAlert error={{ code: "stock", names: cartLineNames(["a", "b"], lineNames) }} errors={errors}/>);
  assert.match(stock, /Tedarikçide şu anda bulunmayan ürünler:/);
  assert.match(stock, /<li>Yağ filtresi \$&amp; &lt;b&gt;<\/li><li>Hava filtresi, büyük<\/li>/);
  assert.match(stock, /href="\/sepet"/);
  assert.match(stock, /break-words/);
  const price = renderToStaticMarkup(<CheckoutErrorAlert error={{ code: "price", names: ["Hava filtresi"] }} errors={errors}/>);
  assert.match(price, /Tedarikçide fiyatı değişen ürünler:/);
  assert.doesNotMatch(price, /href="\/sepet"/);
});

test("without matching lines or a line template the code's general text shows, and an unknown code falls back to stock", () => {
  assert.match(renderToStaticMarkup(<CheckoutErrorAlert error={{ code: "stock", names: [] }} errors={errors}/>), /Genel stok metni\./);
  assert.match(renderToStaticMarkup(<CheckoutErrorAlert error={{ code: "supplier", names: ["Hava filtresi"] }} errors={errors}/>), /Tedarikçi metni\./);
  for (const code of ["nonsense", "constructor", "__proto__"])
    assert.match(renderToStaticMarkup(<CheckoutErrorAlert error={{ code, names: [] }} errors={errors}/>), /Genel stok metni\./, code);
});

test("a refused checkout field names what to fix; an unknown or missing field keeps the general text (#881)", () => {
  const general = { ...errors, validation: "Genel doğrulama metni." };
  const alert = (field?: string) => renderToStaticMarkup(<CheckoutErrorAlert error={{ code: "validation", names: [], field }} errors={general}/>);
  assert.match(alert("postalCode"), /Posta kodu seçili ille uyuşmuyor/);
  assert.match(alert("invoiceTaxNo"), /10 haneli VKN, şahıs işletmeleri için geçerli 11 haneli TC kimlik no/);
  for (const field of [undefined, "requestKey", "constructor", "<b>x</b>"]) assert.match(alert(field), /Genel doğrulama metni\./, String(field));
  // A field only changes the validation error's text.
  assert.match(renderToStaticMarkup(<CheckoutErrorAlert error={{ code: "supplier", names: [], field: "postalCode" }} errors={general}/>), /Tedarikçi metni\./);
});
