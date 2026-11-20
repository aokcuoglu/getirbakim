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

test("home first-screen copy is policy-backed and makes no unsupported claims", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { homeFeatured, homeHero, homeTrust } = await import("@/content/home");
  assert.equal(homeTrust.length, 3);
  assert.equal(homeFeatured.length, 2);
  const copy = JSON.stringify({ homeHero, homeTrust, homeFeatured });
  assert.doesNotMatch(copy, /ücretsiz|bedava/i);
  assert.doesNotMatch(`${homeHero.title} ${homeHero.lead}`, /uyumlu|uyar|garanti/i);
  const policy = JSON.stringify((JSON.parse(readFileSync("src/content/legal-pages.json", "utf8")) as Record<string, unknown>)["teslimat-ve-iade"]);
  const trustCopy = homeTrust.map(item => `${item.title} ${item.text}`).join(" ");
  const days: string[] = trustCopy.match(/\d+ gün/g) ?? [];
  assert.ok(days.includes("14 gün"));
  for (const day of days) assert.ok(policy.includes(day), `${day} is not in teslimat-ve-iade`);
  for (const { image } of homeFeatured) assert.ok(existsSync(`public/media/site/images/${image}`), image);
  assert.doesNotMatch(readFileSync("src/app/(store)/page.tsx", "utf8"), /promotions/);
  assert.doesNotMatch(readFileSync("src/components/home-controls.tsx", "utf8"), /promotions/);
});
