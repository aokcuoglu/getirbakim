import test from "node:test";
import assert from "node:assert/strict";
import { supplierFieldChanges } from "../src/modules/admin/supplier-changes";

test("changes report only changed nested fields and preserve zero and unknown stock", () => {
  assert.deepEqual(supplierFieldChanges(
    { price: { fiyat: 10, kampanyaOrani: 0 }, stock: { varyok1: "VAR", varyok2: null } },
    { stock: { varyok2: "YOK", varyok1: "VAR" }, price: { kampanyaOrani: 0, fiyat: 0 } },
  ), [
    { path: ["price", "fiyat"], before: 10, after: 0 },
    { path: ["stock", "varyok2"], before: null, after: "YOK" },
  ]);
});

test("added and removed fields remain distinct from empty or null values", () => {
  assert.deepEqual(supplierFieldChanges({ product: { removed: "x", empty: "" } }, { product: { empty: null, added: false } }), [
    { path: ["product", "added"], before: undefined, after: false },
    { path: ["product", "empty"], before: "", after: null },
    { path: ["product", "removed"], before: "x", after: undefined },
  ]);
});

test("a new product exposes its initial fields", () => {
  assert.deepEqual(supplierFieldChanges(null, { price: { fiyat: 27.48 }, stock: null }), [
    { path: ["price", "fiyat"], before: undefined, after: 27.48 },
    { path: ["stock"], before: undefined, after: null },
  ]);
});

test("arrays are atomic values and object order inside them does not create a change", () => {
  assert.deepEqual(supplierFieldChanges({ variants: [{ code: "A", price: 1 }] }, { variants: [{ price: 1, code: "A" }] }), []);
  assert.deepEqual(supplierFieldChanges({ variants: [1, 2] }, { variants: [2, 1] }), [
    { path: ["variants"], before: [1, 2], after: [2, 1] },
  ]);
});

test("empty objects and object/null transitions are not lost", () => {
  assert.deepEqual(supplierFieldChanges({}, { empty: {} }), [{ path: ["empty"], before: undefined, after: {} }]);
  assert.deepEqual(supplierFieldChanges({ stock: { varyok1: "VAR" } }, { stock: null }), [
    { path: ["stock"], before: { varyok1: "VAR" }, after: null },
  ]);
});
