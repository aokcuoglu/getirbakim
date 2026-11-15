import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCartCount } from "../src/modules/store/cart-count";

test("a server seed is adopted", () => {
  const store = createCartCount();
  assert.equal(store.get(), null);
  store.seed(3, 100);
  assert.equal(store.get(), 3);
});

test("the same seed stamp does not override a value set by an action", () => {
  const store = createCartCount();
  store.seed(3, 100);
  store.set(5);
  store.seed(3, 100);
  assert.equal(store.get(), 5);
});

test("a new server stamp overrides the stored value", () => {
  const store = createCartCount();
  store.seed(3, 100);
  store.set(5);
  store.seed(1, 200);
  assert.equal(store.get(), 1);
});

test("listeners are notified on change until unsubscribed", () => {
  const store = createCartCount();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls++; });
  store.set(2);
  store.set(2);
  store.seed(4, 1);
  assert.equal(calls, 2);
  unsubscribe();
  store.set(7);
  assert.equal(calls, 2);
});

/** The body of an exported function, up to the next top-level export. */
function body(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("cart actions do not revalidate the layout and return the cart total (#707)", () => {
  const cart = readFileSync(new URL("../src/app/(store)/sepet/actions.ts", import.meta.url), "utf8");
  for (const name of ["addToCart", "changeCartQuantity", "updateCart"]) assert.doesNotMatch(body(cart, name), /revalidatePath\(/, name);
  assert.match(body(cart, "addToCart"), /cartCount/);
  assert.match(body(cart, "changeCartQuantity"), /cartCount/);
  const kit = readFileSync(new URL("../src/app/(store)/bakim-robotu/actions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(kit, /revalidatePath\(/);
  assert.match(body(kit, "addKitToCart"), /cartCount/);
});
