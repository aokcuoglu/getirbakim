import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotNotes } from "../src/modules/store/order-supplier-note";

test("live lines produce no note", () => {
  assert.deepEqual(snapshotNotes([{ code: "A1", supplierLabel: "Başbuğ", snapshot: { checkout_mode: "live" } }, { code: "A2", supplierLabel: null, snapshot: null }]), []);
});
test("record mode names the real suppliers", () => {
  const [note, ...rest] = snapshotNotes([
    { code: "A1", supplierLabel: "Dinamik", snapshot: { checkout_mode: "snapshot" } },
    { code: "A2", supplierLabel: "SETA", snapshot: { checkout_mode: "snapshot" } },
  ]);
  assert.equal(rest.length, 0);
  assert.match(note, /Kayıtlı veri modu: Dinamik ve SETA ürünleri/);
  assert.doesNotMatch(note, /Başbuğ/);
});
test("record mode without a known supplier names none", () => {
  const [note] = snapshotNotes([{ code: "A1", supplierLabel: null, snapshot: { checkout_mode: "snapshot" } }]);
  assert.match(note, /^Kayıtlı veri modu: Ürünler /);
});
test("failed live check is separate and carries the reason", () => {
  const notes = snapshotNotes([
    { code: "A1", supplierLabel: "Dinamik", snapshot: { checkout_mode: "snapshot", live_check: "failed", live_check_reason: "timeout" } },
    { code: "A2", supplierLabel: "Başbuğ", snapshot: { checkout_mode: "snapshot" } },
  ]);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^Kayıtlı veri modu: Başbuğ ürünleri/);
  assert.match(notes[1], /^Canlı doğrulama denendi, başarısız: A1 \(Dinamik\) – zaman aşımı/);
});
