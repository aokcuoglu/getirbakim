import { test } from "node:test";
import assert from "node:assert/strict";
import { kitContentLine, kitCountLabel, kitImageHref, kitImageLayout, kitImageSize, kitKindLabel, kitName, kitPackages, kitSlots, matchingPackage,
  maxKitImageItems, oilPackLitres, oilPackQuantity, orderSlotKeys, type KitSlotKey } from "../src/modules/store/maintenance-kit";

test("count labels follow vowel harmony and upper-case for the headline", () => {
  assert.equal(kitCountLabel(2), "2'li");
  assert.equal(kitCountLabel(3), "3'lü");
  assert.equal(kitCountLabel(4), "4'lü");
  assert.equal(kitCountLabel(5), "5'li");
  assert.equal(kitCountLabel(6), "6'lı");
  assert.equal(kitCountLabel(3, true), "3'LÜ");
  assert.equal(kitCountLabel(5, true), "5'Lİ");
});

test("packages grow from the 3-piece filter set and are recognised from any slot order", () => {
  assert.deepEqual(kitPackages.map(pack => pack.size), [3, 4, 5]);
  assert.equal(matchingPackage(["cabinFilter", "airFilter", "oilFilter"])?.size, 3);
  assert.equal(matchingPackage(["oilFilter", "airFilter", "cabinFilter", "fuelFilter", "engineOil"])?.size, 5);
  assert.equal(matchingPackage(["oilFilter", "airFilter"]), null);
  assert.equal(matchingPackage(["oilFilter", "airFilter", "cabinFilter", "hydraulicFilter"]), null);
  assert.deepEqual(orderSlotKeys(["engineOil", "airFilter", "oilFilter"]), ["oilFilter", "airFilter", "engineOil"]);
});

test("kit kind, content line and name", () => {
  const filters: KitSlotKey[] = ["oilFilter", "airFilter", "cabinFilter"];
  assert.equal(kitKindLabel(filters), "Filtre Seti");
  assert.equal(kitKindLabel([...filters, "engineOil"]), "Bakım Seti");
  assert.equal(kitContentLine(filters), "HAVA-YAĞ-POLEN");
  assert.equal(kitContentLine(["fuelFilter", "oilFilter", "engineOil"]), "YAĞ-YAKIT-MOTOR YAĞI");
  assert.equal(kitName("Fiat Tipo 1.4 2018", filters), "Fiat Tipo 1.4 2018 3'lü Filtre Seti");
  assert.equal(kitName(null, [...filters, "fuelFilter", "engineOil"]), "5'li Bakım Seti");
});

test("every slot has a distinct Trodo category and a part-art kind", () => {
  assert.equal(new Set(kitSlots.map(slot => slot.categoryId)).size, kitSlots.length);
  assert.deepEqual(kitSlots.map(slot => slot.categoryId).sort((a, b) => a - b), [242, 243, 244, 245, 246, 957]);
  for (const slot of kitSlots) assert.ok(["filter", "oil"].includes(slot.art), slot.key);
});

test("oil pack litres are read from product names", () => {
  assert.equal(oilPackLitres("CASTROL EDGE 5W-30 LL 4L"), 4);
  assert.equal(oilPackLitres("SHELL HELIX ULTRA 5W40 1 LT"), 1);
  assert.equal(oilPackLitres("MOTUL 8100 X-CESS 5W40 5 Litre"), 5);
  assert.equal(oilPackLitres("ELF EVOLUTION 900 SXR 5W30 4X1L"), 4);
  assert.equal(oilPackLitres("TOTAL QUARTZ 9000 5W40 0,5 L"), 0.5);
  assert.equal(oilPackLitres("MOBIL SUPER 3000 5W-30 208L"), 208);
  assert.equal(oilPackLitres("MOTOR YAĞI 5W30"), null);
  // "5W40" or part numbers must not read as litres.
  assert.equal(oilPackLitres("YAG FILTRESI W 712/95"), null);
});

test("oil pack quantity covers the capacity and falls back to one pack", () => {
  assert.equal(oilPackQuantity(4.3, 1), 5);
  assert.equal(oilPackQuantity(4.0, 4), 1);
  assert.equal(oilPackQuantity(4.5, 4), 2);
  assert.equal(oilPackQuantity(5.4, 5), 2);
  assert.equal(oilPackQuantity(4.5, null), 1);
  assert.equal(oilPackQuantity(0, 1), 1);
  assert.equal(oilPackQuantity(500, 1), 99);
});

test("image href keeps the given order and at most the layout's items", () => {
  const ids = Array.from({ length: maxKitImageItems + 2 }, (_, index) => `id${index}`);
  assert.equal(kitImageHref(["b", "a"]), "/api/bakim-seti/gorsel?urun=b,a");
  assert.equal(kitImageHref(ids), `/api/bakim-seti/gorsel?urun=${ids.slice(0, maxKitImageItems).join(",")}`);
});

test("image layout is deterministic, inside the canvas and never overlapping", () => {
  for (let count = 1; count <= maxKitImageItems; count++) {
    const layout = kitImageLayout(count);
    assert.deepEqual(layout, kitImageLayout(count));
    assert.equal(layout.cells.length, count);
    const boxes = [layout.panel, ...layout.cells];
    for (const box of boxes) {
      assert.ok(box.x >= 0 && box.y >= 0 && box.width > 100 && box.height > 100, JSON.stringify(box));
      assert.ok(box.x + box.width <= kitImageSize && box.y + box.height <= kitImageSize, JSON.stringify(box));
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      assert.ok(!overlap, `boxes ${i} and ${j} overlap for ${count} items`);
    }
  }
  assert.deepEqual(kitImageLayout(0).cells.length, 1);
  assert.deepEqual(kitImageLayout(99).cells.length, maxKitImageItems);
});
