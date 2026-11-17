import assert from "node:assert/strict";
import test from "node:test";
import { looksLikePartCode } from "@/modules/search/query";
import { popularVehicleMakes, splitPopularBrands, turkeyPopularMakes } from "@/modules/store/vehicle-catalog";

test("looksLikePartCode tells part numbers from words and specs", () => {
  for (const code of ["06A115561B", "GDB1330", "0 986 494 104", "W 712/75", "HU 719/7 x"]) assert.equal(looksLikePartCode(code), true, code);
  for (const text of ["fren diski", "golf 7 balata", "5w40", "bmw 320d", "1.6 16v", "2015"]) assert.equal(looksLikePartCode(text), false, text);
});

test("splitPopularBrands orders popular makes by Türkiye rank and keeps the rest as received", () => {
  const brands = ["AUDI", "Citroën", "FORD", "BMW", "FIAT", "SKODA"].map(name => ({ name }));
  const { popular, others } = splitPopularBrands(brands);
  assert.deepEqual(popular.map(brand => brand.name), ["FIAT", "FORD", "Citroën"]);
  assert.deepEqual(others.map(brand => brand.name), ["AUDI", "BMW", "SKODA"]);
});

test("splitPopularBrands skips makes the list does not have", () => {
  assert.deepEqual(splitPopularBrands([{ name: "RENAULT" }]), { popular: [{ name: "RENAULT" }], others: [] });
  assert.deepEqual(splitPopularBrands([]), { popular: [], others: [] });
});

test("popularVehicleMakes leads with the Türkiye makes and has no duplicates", () => {
  assert.deepEqual(popularVehicleMakes.slice(0, 10), turkeyPopularMakes);
  assert.equal(new Set(popularVehicleMakes).size, popularVehicleMakes.length);
});
