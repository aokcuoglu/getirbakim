import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CartActionBar } from "../src/components/cart-action-bar";
import { CheckoutSteps } from "../src/components/checkout-steps";
import { cartOrderable } from "../src/components/cart-orderable";

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
