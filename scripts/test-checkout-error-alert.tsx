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
