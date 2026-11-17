import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSignal, modelTokens, packHint, packTokens, priceRatio, signalDecision, suffixExtension, suffixHints, tokenOverlap, wilsonLower, yearRange, yearsOverlap, type SignalMetrics, type SuffixStatus } from "../src/modules/admin/product-suffix-signals";

const metrics = (correct: number, wrong: number): SignalMetrics => ({
  fires: correct + wrong, correct, wrong, precision: correct / (correct + wrong || 1), recall: 0, coverage: 0, wilson: wilsonLower(correct, correct + wrong),
});
const clean = { contradictions: 0, trustedWrong: 0 };

test("wilsonLower matches known values", () => {
  assert.equal(wilsonLower(0, 0), 0);
  assert.ok(Math.abs(wilsonLower(10, 10) - 0.7225) < 0.001);
  assert.ok(Math.abs(wilsonLower(27, 27) - 0.8754) < 0.001);
  assert.ok(wilsonLower(5, 10) < 0.5 && wilsonLower(5, 10) > 0.2);
});

test("evaluateSignal counts fires, hits, recall and coverage", () => {
  const pairs: { status: SuffixStatus; hit: boolean }[] = [
    { status: "different", hit: true }, { status: "different", hit: true }, { status: "different", hit: false },
    { status: "same", hit: true }, { status: "same", hit: false }, { status: "same", hit: false },
  ];
  const result = evaluateSignal(pairs, pair => pair.hit, "different");
  assert.equal(result.fires, 3);
  assert.equal(result.correct, 2);
  assert.equal(result.wrong, 1);
  assert.ok(Math.abs(result.precision - 2 / 3) < 1e-9);
  assert.ok(Math.abs(result.recall - 2 / 3) < 1e-9);
  assert.equal(result.coverage, 0.5);
  assert.equal(evaluateSignal(pairs, () => false, "same").precision, 0);
});

test("signalDecision applies the documented thresholds", () => {
  assert.equal(signalDecision("different", metrics(25, 0), clean), "adopt-different");
  assert.equal(signalDecision("different", metrics(40, 1), clean), "adopt-different");
  assert.equal(signalDecision("different", metrics(9, 0), clean), "reject");
  assert.equal(signalDecision("different", metrics(10, 2), clean), "reject");
  assert.equal(signalDecision("different", metrics(10, 0), clean), "reject", "Wilson bound below 0.85");
  assert.equal(signalDecision("different", metrics(25, 0), { contradictions: 3, trustedWrong: 0 }), "reject");
  assert.equal(signalDecision("same", metrics(60, 0), clean), "adopt-same");
  assert.equal(signalDecision("same", metrics(30, 1), clean), "reject");
  assert.equal(signalDecision("same", metrics(29, 0), clean), "reject");
  assert.equal(signalDecision("same", metrics(60, 0), { contradictions: 5, trustedWrong: 0 }), "reject");
  assert.equal(signalDecision("same", metrics(60, 0), { contradictions: 0, trustedWrong: 1 }), "reject");
});

test("packTokens finds pack words in names and extensions", () => {
  assert.deepEqual(packTokens("HALOGEN AMPUL HB3 12V 60W (IKILI)", ""), ["IKILI"]);
  assert.deepEqual(packTokens("HALOGEN AMPUL", "2BL"), ["2BL"]);
  assert.deepEqual(packTokens("AKS KAFASI DIS SET", ""), ["SET"]);
  assert.deepEqual(packTokens("FILTRE 4 ADET", ""), ["4ADET"]);
  assert.deepEqual(packTokens("AMPUL", "1BL"), ["1BL"]);
  assert.deepEqual(packTokens("KAMPANA FREN", "K"), []);
});

test("yearRange reads Başbuğ and Dinamik spans", () => {
  assert.deepEqual(yearRange("13-"), [2013, null]);
  assert.deepEqual(yearRange("15-19"), [2015, 2019]);
  assert.deepEqual(yearRange("2017>2020", false), [2017, 2020]);
  assert.deepEqual(yearRange("ON FREN BALATA 08>", false), [2008, null]);
  assert.deepEqual(yearRange("AMORTISOR 05> 11", false), [2005, 2011]);
  assert.equal(yearRange("."), null);
  assert.equal(yearRange("TGS-TGX D2676", false), null);
  assert.equal(yearRange("D2676-12", true), null);
});

test("yearsOverlap treats an open end as open", () => {
  assert.ok(yearsOverlap([2013, null], [2015, 2019]));
  assert.ok(!yearsOverlap([2005, 2011], [2013, null]));
  assert.ok(yearsOverlap([2005, 2011], [2011, 2012]));
});

test("modelTokens keeps model words and drops digits", () => {
  assert.deepEqual(modelTokens("GOLF5-GOLF6-JETTA-PASSAT"), ["GOLF", "JETTA", "PASSAT"]);
  assert.deepEqual(modelTokens(""), []);
  assert.equal(tokenOverlap(modelTokens("GOLF5-JETTA"), modelTokens("VW GOLF 5 ON AMORTISOR")), 1);
  assert.equal(tokenOverlap([], ["GOLF"]), 0);
});

test("suffixExtension names the extension and the longer side", () => {
  assert.deepEqual(suffixExtension("64210NL", "64210NLHCB"), { ext: "HCB", longer: "b" });
  assert.deepEqual(suffixExtension("64210NLHCB", "64210NL"), { ext: "HCB", longer: "a" });
  assert.deepEqual(suffixExtension("ABC", "ABC"), { ext: "", longer: "b" });
});

test("priceRatio is symmetric and empty without two positive costs", () => {
  assert.equal(priceRatio(10, null), null);
  assert.equal(priceRatio(null, 10), null);
  assert.equal(priceRatio(0, 10), null);
  assert.equal(priceRatio(10, 25), 2.5);
  assert.equal(priceRatio(25, 10), 2.5);
  assert.equal(priceRatio(10, 10), 1);
});

test("packHint compares pack words per side and puts the extension marker on the longer one", () => {
  const plain = { partNumber: "1234", name: "FILTRE" };
  assert.deepEqual(packHint(plain, { partNumber: "12342", name: "FILTRE IKILI" }), { a: [], b: ["IKILI"], differs: true });
  assert.deepEqual(packHint({ partNumber: "1234", name: "AMPUL" }, { partNumber: "12342BL", name: "AMPUL" }), { a: [], b: ["2BL"], differs: true });
  assert.deepEqual(packHint({ partNumber: "12342BL", name: "AMPUL" }, { partNumber: "1234", name: "AMPUL" }), { a: ["2BL"], b: [], differs: true });
  assert.equal(packHint({ partNumber: "1234", name: "FILTRE SETI" }, { partNumber: "12342", name: "FILTRE SETI" }).differs, false);
  assert.deepEqual(packHint({ partNumber: "1234", name: null }, { partNumber: "12342", name: null }), { a: [], b: [], differs: false });
});

test("suffixHints flags a price ratio above 2 and keeps the boundary quiet", () => {
  const hints = suffixHints({ partNumber: "64210NL", name: "OSRAM AMPUL", costTry: 100 }, { partNumber: "64210NLHCB", name: "OSRAM AMPUL", costTry: 240 });
  assert.ok(hints.priceRatio !== null && Math.abs(hints.priceRatio - 2.4) < 1e-9);
  assert.equal(hints.priceWarning, true);
  assert.equal(hints.pack.differs, false);
  assert.equal(suffixHints({ partNumber: "A", name: null, costTry: 100 }, { partNumber: "AB", name: null, costTry: 200 }).priceWarning, false, "exactly 2 is not above 2");
  assert.equal(suffixHints({ partNumber: "A", name: null, costTry: 100 }, { partNumber: "AB", name: null, costTry: 201 }).priceWarning, true);
  assert.equal(suffixHints({ partNumber: "A", name: null, costTry: null }, { partNumber: "AB", name: null, costTry: 201 }).priceWarning, false);
});
