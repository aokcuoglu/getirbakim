import assert from "node:assert/strict";
import test from "node:test";
import { complementaryCategories, complementsFor, fillerSection, pickRelated, universalCategories, type RelatedInput } from "../src/modules/store/related-rules";

const input = (overrides: Partial<RelatedInput>): RelatedInput =>
  ({ complements: [], fitScore: new Map(), exclude: new Set(), perCategory: 4, ...overrides });

test("the complementary category map is well formed", () => {
  for (const [key, complements] of Object.entries(complementaryCategories)) {
    const id = Number(key);
    assert.ok(Number.isInteger(id) && id > 0, `${key} is a category id`);
    assert.ok(complements.length > 0, `${key} lists complements`);
    assert.ok(!complements.includes(id), `${key} never suggests its own category (an equivalent, not a related item)`);
    assert.equal(new Set(complements).size, complements.length, `${key} lists each complement once`);
    for (const complement of complements) assert.ok(Number.isInteger(complement) && complement > 0);
  }
  assert.deepEqual(complementaryCategories[269], [268, 281, 960]);
  assert.equal(complementaryCategories[242][0], 957);
  assert.ok(universalCategories.has(957) && universalCategories.has(960));
});

test("the deepest category with complements decides", () => {
  assert.deepEqual(complementsFor([252, 269]), [268, 281, 960]);
  assert.deepEqual(complementsFor([252, 269, 99999]), [268, 281, 960]);
  assert.deepEqual(complementsFor([252]), []);
  assert.deepEqual(complementsFor([]), []);
});

test("categories take turns so the first picks cover different parts", () => {
  const picked = pickRelated(input({ complements: [
    { categoryId: 268, ids: ["p1", "p2", "p3"] }, { categoryId: 281, ids: ["s1"] }, { categoryId: 960, ids: ["f1", "f2"] },
  ], fitScore: new Map([["p1", 1], ["p2", 1], ["p3", 1], ["s1", 1]]) }));
  assert.deepEqual(picked.map(pick => pick.id), ["p1", "s1", "f1", "p2", "f2", "p3"]);
  assert.deepEqual(picked.slice(0, 3).map(pick => pick.categoryId), [268, 281, 960]);
});

test("without a known vehicle only fluids are suggested", () => {
  const picked = pickRelated(input({ complements: [{ categoryId: 268, ids: ["a", "b"] }, { categoryId: 960, ids: ["f2", "f1"] }], fitScore: null }));
  assert.deepEqual(picked.map(pick => pick.id), ["f1", "f2"]);
});

test("with a vehicle the best fitting come first; parts not known to fit are dropped, fluids kept", () => {
  const picked = pickRelated(input({
    complements: [{ categoryId: 268, ids: ["a", "b", "c", "d"] }, { categoryId: 960, ids: ["fluid"] }],
    fitScore: new Map([["c", 3], ["d", 1]]),
  }));
  // a and b: no shared model (fitted elsewhere or fit unknown) → dropped; fluid: universal → kept.
  assert.deepEqual(picked.map(pick => pick.id), ["c", "fluid", "d"]);
});

test("excluded ids, duplicates and the per-category limit are respected", () => {
  const picked = pickRelated(input({
    complements: [{ categoryId: 268, ids: ["x", "a", "a", "b", "c"] }, { categoryId: 269, ids: ["a", "d"] }],
    fitScore: new Map(["x", "a", "b", "c", "d"].map(id => [id, 1])), exclude: new Set(["x"]), perCategory: 2,
  }));
  assert.deepEqual(picked, [{ id: "a", categoryId: 268 }, { id: "d", categoryId: 269 }, { id: "b", categoryId: 268 }]);
});

test("ties break by id so the result is stable", () => {
  const run = () => pickRelated(input({ complements: [{ categoryId: 268, ids: ["z", "m", "a"] }], fitScore: new Map([["z", 1], ["m", 1], ["a", 1]]) }));
  assert.deepEqual(run().map(pick => pick.id), ["a", "m", "z"]);
  assert.deepEqual(run(), run());
});

test("the filler's section is one level above the category, never the whole car parts tree", () => {
  assert.equal(fillerSection([3, 252, 269]), 252);
  assert.equal(fillerSection([3, 4, 168, 175]), 168);
  assert.equal(fillerSection([3, 4, 10036, 187]), 10036);
  assert.equal(fillerSection([956, 957]), 956);
  assert.equal(fillerSection([252, 274]), 252);
  assert.equal(fillerSection([956]), 956);
});
