import assert from "node:assert/strict";
import test from "node:test";
import { pickKey } from "../src/lib/table-sort";

const table = { all: 1, paid: 2 };

test("pickKey accepts own keys only and otherwise falls back", () => {
  assert.equal(pickKey(table, "paid", "all"), "paid");
  assert.equal(pickKey(table, "missing", "all"), "all");
  assert.equal(pickKey(table, undefined, "all"), "all");
  for (const raw of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(pickKey(table, raw, "all"), "all");
});
