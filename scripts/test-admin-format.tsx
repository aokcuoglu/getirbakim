import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { durationSeconds, formatClock, formatDate, formatDuration, formatInterval, formatNumber } from "../src/modules/admin/format";
import { runKindLabel, runScopeLabel, runStatusLabel, runStatusTone, scheduleLines } from "../src/modules/suppliers/run-status";
import { supplierInitialTab } from "../src/components/admin/supplier-page";
import { pageHref, pageWindow } from "../src/components/admin/supplier-pagination";
import { RunStatusBadge } from "../src/components/admin/status-badge";

test("numbers use Turkish grouping, at most two decimals, missing reads 0", () => {
  assert.equal(formatNumber(1234567), "1.234.567");
  assert.equal(formatNumber(12.345), "12,35");
  assert.equal(formatNumber(null), "0");
  assert.equal(formatNumber(undefined), "0");
});

test("dates read in Istanbul time in the overview's short style; another year adds the year", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(formatDate(new Date("2026-11-14T00:05:00Z"), { now }), "14 Kas 03:05");
  assert.equal(formatDate(new Date("2025-12-31T22:30:00Z"), { now }), "01 Oca 01:30");
  assert.equal(formatDate(new Date("2025-06-01T09:00:00Z"), { now }), "01 Haz 2025 12:00");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined, { fallback: "Henüz yok" }), "Henüz yok");
});

test("durations are compact and an unfinished run is still running", () => {
  const start = new Date("2026-11-14T10:00:00Z");
  const after = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  assert.equal(formatDuration(start, after(45)), "45 sn");
  assert.equal(formatDuration(start, after(185)), "3 dk 5 sn");
  assert.equal(formatDuration(start, after(120)), "2 dk");
  assert.equal(formatDuration(start, after(3720)), "1 sa 2 dk");
  assert.equal(formatDuration(start, after(7200)), "2 sa");
  assert.equal(formatDuration(start, null), "Devam ediyor");
  assert.equal(durationSeconds(start, after(-5)), 0);
  assert.equal(durationSeconds(start, null), null);
});

test("intervals have one wording", () => {
  assert.equal(formatInterval(30), "30 dakikada bir");
  assert.equal(formatInterval(120), "2 saatte bir");
  assert.equal(formatInterval(1440), "her gün");
  assert.equal(formatInterval(1440, "04:00:00"), "her gün 04:00");
  assert.equal(formatInterval(4320), "3 günde bir");
  assert.equal(formatInterval(null), "—");
  assert.equal(formatClock("03:00:00"), "03:00");
});

test("run status, kind and scope labels are shared by every supplier", () => {
  assert.equal(runStatusLabel("succeeded"), "Başarılı");
  assert.equal(runStatusLabel("rejected"), "İnceleme gerekli");
  assert.equal(runStatusTone("failed"), "error");
  assert.equal(runStatusTone("running"), "info");
  assert.equal(runStatusTone("unknown"), "neutral");
  assert.equal(runStatusLabel("unknown"), "unknown");
  assert.equal(runKindLabel("full", "basbug"), "Tam liste");
  assert.equal(runKindLabel("commerce", "basbug"), "Fiyat · stok · kur");
  assert.equal(runKindLabel("commerce", "seta"), "Fiyat · stok");
  assert.equal(runKindLabel(undefined, "dinamik"), "Tam liste");
  assert.equal(runScopeLabel("ALL"), "Tüm liste");
  const html = renderToStaticMarkup(<RunStatusBadge status="rejected"/>);
  assert.match(html, /data-variant="warning"|warning/);
  assert.match(html, /İnceleme gerekli/);
});

test("the plan is read from the sync scopes, the most common one named", () => {
  const scope = (interval: number, daily: string, commerce: boolean, commerceInterval = 30) =>
    ({ enabled: true, interval_minutes: interval, daily_at: daily, commerce_enabled: commerce, commerce_interval_minutes: commerceInterval });
  assert.deepEqual(scheduleLines([scope(1440, "03:00", true), scope(1440, "03:00", true), scope(1440, "04:00", true, 60)]),
    ["Ürün listesi her gün 03:00", "Fiyat · stok 30 dakikada bir"]);
  assert.deepEqual(scheduleLines([scope(1440, "04:00", false)], { catalogLabel: "Markalar" }), ["Markalar her gün 04:00"]);
  assert.deepEqual(scheduleLines([{ ...scope(1440, "03:00", true), enabled: false }], { commerceLabel: "Fiyat · stok · kur" }),
    ["Ürün listesi: otomatik çekim kapalı", "Fiyat · stok · kur 30 dakikada bir"]);
});

test("a supplier page opens on the sync tab when something needs attention or there is no data", () => {
  assert.equal(supplierInitialTab({ attention: false, hasData: true }), "products");
  assert.equal(supplierInitialTab({ attention: true, hasData: true }), "transfer");
  assert.equal(supplierInitialTab({ attention: false, hasData: false }), "transfer");
});

test("pagination keeps filters and the header sort", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 4, 5, 20]);
  assert.deepEqual(pageWindow(10, 20), [1, 8, 9, 10, 11, 12, 20]);
  assert.deepEqual(pageWindow(20, 20), [1, 16, 17, 18, 19, 20]);
  assert.equal(pageHref("/yonetim/tedarikciler/seta", { q: "filtre", stock: "1", sort: "cost", dir: "desc", updated: "1" }, ["q", "stock", "sort", "dir"], 3),
    "/yonetim/tedarikciler/seta?q=filtre&stock=1&sort=cost&dir=desc&page=3");
});
