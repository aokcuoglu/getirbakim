import assert from "node:assert/strict";
import test from "node:test";
import { complementaryCategories, complementsFor, fillerSection, pickRelated, rankOils, stableHash, universalCategories, unrelatedFluids,
  type OilCandidate, type OilTarget, type RelatedInput } from "../src/modules/store/related-rules";
import { productOilSpec, type VehicleOilSpec } from "../src/modules/store/vehicle-oil";

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

test("a fluid's dialog leaves out fluids of another job: no transmission oil after engine oil", () => {
  assert.deepEqual(unrelatedFluids[957], [958]);
  for (const [key, fluids] of Object.entries(unrelatedFluids)) {
    assert.ok(universalCategories.has(Number(key)), `${key} is a fluid`);
    for (const fluid of fluids) assert.ok(universalCategories.has(fluid) && fluid !== Number(key));
  }
});

test("the stable hash is FNV-1a and the same across calls", () => {
  assert.equal(stableHash(""), 0x811c9dc5);
  assert.equal(stableHash("a"), 0xe40c292c);
  assert.equal(stableHash("filter:oil"), stableHash("filter:oil"));
  assert.notEqual(stableHash("filter-1:oil"), stableHash("filter-2:oil"));
});

const oil = (id: string, name: string, litres: number): OilCandidate => ({ id, spec: productOilSpec(name)!, litres });
const target = (spec: Partial<VehicleOilSpec>, weight = 1): OilTarget =>
  ({ weight, spec: { viscosities: [], acea: [], api: [], approvals: [], capacityMin: null, capacityMax: null, ...spec } });

test("engine oil: a full match (grade and approval) before a grade-only match; strict drops oils matching nothing", () => {
  const oils = [oil("grade", "MOTOR YAGI 5W-30 4 LT", 4), oil("full", "MOTOR YAGI 5W-30 C3 VW 504 00 4 LT", 4), oil("other", "MOTOR YAGI 10W-40 4 LT", 4)];
  const vehicle = target({ viscosities: ["5W-30"], approvals: ["VW 504 00"] });
  assert.deepEqual(rankOils(oils, [vehicle], { seed: "f", strict: true }), ["full", "grade"]);
  assert.deepEqual(rankOils(oils, [vehicle], { seed: "f", strict: false }), ["full", "grade", "other"]);
});

test("engine oil: with several fitted types the grade most of them take comes first", () => {
  const oils = [oil("a", "MOTOR YAGI 5W-30 4 LT", 4), oil("b", "MOTOR YAGI 10W-40 4 LT", 4), oil("c", "MOTOR YAGI 0W-20 4 LT", 4)];
  const targets = [target({ viscosities: ["5W-30"] }, 2), target({ viscosities: ["10W-40"] }, 5)];
  assert.deepEqual(rankOils(oils, targets, { seed: "f", strict: false }), ["b", "a", "c"]);
});

test("engine oil: the fewest packs for the capacity first; unknown capacity counts as 4 L, so a 1 L bottle goes last", () => {
  const oils = [oil("one", "MOTOR YAGI 5W-30 1 LT", 1), oil("four", "MOTOR YAGI 5W-30 4 LT", 4), oil("five", "MOTOR YAGI 5W-30 5 LT", 5)];
  const vehicle = target({ viscosities: ["5W-30"] });
  // 4.5 L: one 5 L can, two 4 L cans, five 1 L bottles.
  assert.deepEqual(rankOils(oils, [vehicle], { seed: "f", strict: true, capacityLitres: 4.5 }), ["five", "four", "one"]);
  const fourLitres = rankOils(oils, [vehicle], { seed: "f", strict: true, capacityLitres: 4 });
  assert.ok(fourLitres.indexOf("four") < fourLitres.indexOf("one"));
  assert.equal(rankOils(oils, [], { seed: "f", strict: false }).at(-1), "one");
});

test("engine oil without targets: the same product gets the same oil, different products different ones", () => {
  const oils = Array.from({ length: 30 }, (_, i) => oil(`o${i}`, "MOTOR YAGI 5W-30 4 LT", 4));
  assert.deepEqual(rankOils(oils, [], { seed: "filter-1", strict: false }), rankOils(oils, [], { seed: "filter-1", strict: false }));
  const firsts = new Set(Array.from({ length: 20 }, (_, i) => rankOils(oils, [], { seed: `filter-${i}`, strict: false })[0]));
  assert.ok(firsts.size > 5, `${firsts.size} distinct first oils`);
});

test("engine oil: a target the oil data cannot filter by is ignored, so strict keeps every oil", () => {
  const oils = [oil("a", "MOTOR YAGI 5W-30 4 LT", 4), oil("b", "MOTOR YAGI 10W-40 4 LT", 4)];
  assert.equal(rankOils(oils, [target({ api: ["SN"], capacityMax: 4 })], { seed: "f", strict: true }).length, 2);
});

test("an ordered category keeps its order; fluid ties rotate with the seed, without a seed they stay in id order", () => {
  const picked = pickRelated(input({ complements: [{ categoryId: 957, ids: ["z", "x", "y"] }], fitScore: null, ordered: new Set([957]), exclude: new Set(["x"]) }));
  assert.deepEqual(picked.map(pick => pick.id), ["z", "y"]);
  const ids = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, "0")}`);
  const first = (seed?: string) => pickRelated(input({ complements: [{ categoryId: 960, ids }], fitScore: null, perCategory: 12, seed }))[0].id;
  assert.equal(first(), "f00");
  assert.equal(first("disc-1"), first("disc-1"));
  assert.ok(new Set(Array.from({ length: 12 }, (_, i) => first(`disc-${i}`))).size > 3);
  // Vehicle-specific categories keep id order for ties even with a seed.
  const pads = pickRelated(input({ complements: [{ categoryId: 268, ids: ["b", "a"] }], fitScore: new Map([["a", 1], ["b", 1]]), seed: "disc-1" }));
  assert.deepEqual(pads.map(pick => pick.id), ["a", "b"]);
});
