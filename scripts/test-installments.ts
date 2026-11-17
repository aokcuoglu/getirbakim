import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installmentFingerprint, installmentHint, installmentOptions, installmentTotal, type InstallmentSettings,
} from "../src/modules/payments/installment-plan";

// Installment fee arithmetic (#886); no database.
const seed: InstallmentSettings = {
  enabled: true, max: 6, minBasketKurus: 0, singleRateBp: 285,
  ratesBp: { 2: 589, 3: 795, 4: 988, 5: 1172, 6: 1347, 7: 1539, 8: 1723, 9: 1897, 10: 2085, 11: 2271, 12: 2432 },
};

test("disabled installments offer only the single payment", () => {
  const options = installmentOptions({ ...seed, enabled: false }, 100000);
  assert.deepEqual(options, [{ count: 1, feeKurus: 0, totalKurus: 100000, monthlyKurus: 100000 }]);
});

test("the single payment carries no fee", () => {
  const [single] = installmentOptions(seed, 100000);
  assert.deepEqual(single, { count: 1, feeKurus: 0, totalKurus: 100000, monthlyKurus: 100000 });
});

test("totals follow cash × (1 − single) / (1 − rate)", () => {
  const options = installmentOptions(seed, 100000);
  const six = options.find(option => option.count === 6)!;
  assert.equal(six.totalKurus, 112273);
  assert.equal(six.feeKurus, 12273);
  const three = options.find(option => option.count === 3)!;
  assert.equal(three.totalKurus, 105540);
  assert.equal(three.feeKurus, 5540);
  assert.equal(installmentTotal(100000, 285, 1347), 112273);
});

test("counts stop at the maximum and below the minimum basket", () => {
  assert.deepEqual(installmentOptions(seed, 100000).map(option => option.count), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(installmentOptions({ ...seed, max: 12 }, 100000).map(option => option.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(installmentOptions({ ...seed, max: 2 }, 100000).map(option => option.count), [1, 2]);
  // The minimum compares the basket (subtotal), not the cash total with shipping.
  assert.equal(installmentOptions({ ...seed, minBasketKurus: 50000 }, 52000, 49999).length, 1);
  assert.equal(installmentOptions({ ...seed, minBasketKurus: 50000 }, 52000, 50000).length, 6);
  assert.equal(installmentOptions(seed, 0).length, 1);
});

test("a count without a rate is skipped", () => {
  const { 4: _removed, ...rates } = seed.ratesBp;
  assert.equal(_removed, 988);
  assert.deepEqual(installmentOptions({ ...seed, ratesBp: rates }, 100000).map(option => option.count), [1, 2, 3, 5, 6]);
});

test("a rate below the single rate charges no fee", () => {
  assert.equal(installmentTotal(100000, 285, 100), 100000);
  const two = installmentOptions({ ...seed, ratesBp: { 2: 200 } }, 100000).find(option => option.count === 2)!;
  assert.equal(two.feeKurus, 0);
  assert.equal(installmentTotal(100000, 285, 285), 100000);
});

test("half a kuruş rounds up, below half rounds down", () => {
  // 1 × 9000 / 8000 = 1.125 → 1; 3 × 9000 / 6000 = 4.5 → 5; 5 × 9000 / 8000 = 5.625 → 6.
  assert.equal(installmentTotal(1, 1000, 2000), 1);
  assert.equal(installmentTotal(3, 1000, 4000), 5);
  assert.equal(installmentTotal(5, 1000, 2000), 6);
});

test("the monthly amount is the total split evenly, rounded", () => {
  const six = installmentOptions(seed, 100000).find(option => option.count === 6)!;
  assert.equal(six.monthlyKurus, Math.round(112273 / 6));
  assert.equal(six.monthlyKurus, 18712);
});

test("the fingerprint changes with every setting that changes a total", () => {
  const base = JSON.stringify(installmentFingerprint(seed));
  assert.notEqual(JSON.stringify(installmentFingerprint({ ...seed, max: 7 })), base);
  assert.notEqual(JSON.stringify(installmentFingerprint({ ...seed, minBasketKurus: 1 })), base);
  assert.notEqual(JSON.stringify(installmentFingerprint({ ...seed, singleRateBp: 290 })), base);
  assert.notEqual(JSON.stringify(installmentFingerprint({ ...seed, ratesBp: { ...seed.ratesBp, 3: 800 } })), base);
  assert.equal(JSON.stringify(installmentFingerprint({ ...seed })), base);
});

test("the hosted page hint names the count", () => {
  assert.equal(installmentHint(3), "TAMI ödeme sayfasında 3 taksit seçin");
});
