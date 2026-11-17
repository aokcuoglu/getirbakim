import assert from "node:assert/strict";
import test from "node:test";
import { popularVehicleMakes, splitPopularBrands, turkeyPopularMakes } from "@/modules/store/vehicle-catalog";

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
