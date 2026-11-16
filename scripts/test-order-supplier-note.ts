import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotNotes } from "../src/modules/admin/order-supplier-note";

const record = (code: string, supplierLabel: string | null, extra: Record<string, unknown> = {}) => ({ code, supplierLabel, snapshot: { checkout_mode: "snapshot", ...extra } });

test("live lines produce no note", () => {
  assert.deepEqual(snapshotNotes([{ code: "A1", supplierLabel: "Başbuğ", snapshot: { checkout_mode: "live" } }, { code: "A2", supplierLabel: null, snapshot: null }]), []);
});
test("record mode names the real suppliers, deduplicated", () => {
  const notes = snapshotNotes([record("A1", "Dinamik"), record("A2", "SETA"), record("A3", "Dinamik")]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /\(Dinamik ve SETA\)/);
  assert.match(notes[0], /kayıtlı veri modu: Bu sipariş kalemleri/);
  assert.doesNotMatch(notes[0], /Başbuğ/);
});
test("three or more names are joined with commas and ve", () => {
  assert.match(snapshotNotes([record("A1", "Başbuğ"), record("A2", "Dinamik"), record("A3", "SETA")])[0], /\(Başbuğ, Dinamik ve SETA\)/);
});
test("one record line is singular and no supplier names none", () => {
  const [note] = snapshotNotes([record("A1", null)]);
  assert.match(note, /Bu sipariş kalemi tedarikçinin/);
  assert.doesNotMatch(note, /\(/);
});
test("failed live check is separate and carries the reason", () => {
  const notes = snapshotNotes([record("A1", "Dinamik", { live_check: "failed", live_check_reason: "timeout" }), record("A2", "Başbuğ")]);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /\(Başbuğ\) tedarikçinin/);
  assert.match(notes[1], /canlı doğrulama denendi ama başarısız oldu: A1 \(Dinamik\) – zaman aşımı\. Bu kalem /);
});
test("failed lines: unknown, missing reason and missing supplier use one fallback", () => {
  const [note] = snapshotNotes([
    record("A1", "SETA", { live_check: "failed", live_check_reason: "weird" }),
    record("A2", "SETA", { live_check: "failed" }),
    record("A3", null, { live_check: "failed", live_check_reason: "busy" }),
  ]);
  assert.match(note, /A1 \(SETA\) – bilinmeyen neden; A2 \(SETA\) – bilinmeyen neden; A3 – tedarikçi meşgul\. Bu kalemler /);
});
