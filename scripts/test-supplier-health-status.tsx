import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { SupplierHealthStatus } from "../src/components/admin/supplier-health-status";
import { SupplierQualityCard } from "../src/components/admin/supplier-quality-card";
import { supplierHealthBody, type SupplierHealthScope } from "../src/modules/suppliers/health";

const now = new Date("2026-11-14T09:00:00Z");
const scope = (supplier: string, list_group: string, issue: Partial<SupplierHealthScope> = {}): SupplierHealthScope => ({
  supplier, company: supplier.toUpperCase(), list_group, warehouse: supplier === "basbug" ? "MRK" : "ALL",
  enabled: true, commerce_enabled: false, interval_minutes: 1440, stale_minutes: 2160, last_success_at: now, next_run_at: now,
  consecutive_failures: 0, commerce_interval_minutes: 30, commerce_stale_minutes: 90, commerce_last_success_at: null, commerce_next_run_at: now,
  commerce_failures: 0, catalog_stale: false, commerce_stale: false, ...issue,
});
const health = (scopes: SupplierHealthScope[], manual = false) => ({
  checked_at: now, manual, healthy: false, heartbeat: { started_at: now, finished_at: now, succeeded: true, alive: true }, scopes, issues: scopes,
});
const refresh = async () => {};
const render = (node: ReactElement) => renderToString(node).replaceAll("<!-- -->", "");

test("a fresh supplier with the scheduler off on purpose shows the neutral manual note", () => {
  const html = render(<SupplierHealthStatus health={health([scope("seta", "ALL")], true)} supplier="seta" name="SETA" unit="liste" refresh={refresh} refreshDescription="x"/>);
  assert.match(html, /Otomatik güncelleme kapalı/);
  assert.match(html, /SETA verileri elle yenileniyor/);
  assert.equal(render(<SupplierHealthStatus health={health([scope("seta", "ALL")])} supplier="seta" name="SETA" unit="liste" refresh={refresh} refreshDescription="x"/>), "");
});

test("Dinamik names its brands, sorts the most failing first and retries by brand", () => {
  const scopes = Array.from({ length: 120 }, (_, i) => scope("dinamik", `MARKA${String(i).padStart(3, "0")}`, { catalog_stale: true, consecutive_failures: i === 90 ? 4 : 0 }));
  const html = render(<SupplierHealthStatus health={health([...scopes, scope("basbug", "FIAT", { catalog_stale: true })])} supplier="dinamik" name="Dinamik" unit="marka" refresh={refresh} refreshField="brand" refreshDescription="x" limit={50}/>);
  assert.match(html, /Dinamik verileri güncel değil; güncelleme gerekiyor/);
  assert.match(html, /120 markada güncelleme sorunu var/);
  assert.doesNotMatch(html, /Başbuğ|FIAT/);
  // The most failing brand comes first; the rest are counted, not named.
  assert.match(html, /Ayrıntıları gör · MARKA090, MARKA000/);
  assert.match(html, /MARKA003 \+115/);
  assert.match(html, /name="brand"/);
  assert.match(html, /Seçili markayı yeniden dene/);
});

test("Başbuğ keeps to its warehouse and group; SETA retries its single list without a selector", () => {
  const basbug = render(<SupplierHealthStatus health={health([scope("basbug", "FIAT", { commerce_enabled: true, commerce_stale: true }), scope("basbug", "BMW", { catalog_stale: true })])}
    supplier="basbug" name="Başbuğ" unit="grup" warehouse="MRK" group="FIAT" refresh={refresh} refreshField="group" commerceLabel="Fiyat · stok · kur" refreshDescription="x"/>);
  assert.match(basbug, /1 grupta güncelleme sorunu var/);
  assert.match(basbug, /Fiyat · stok · kur: 1 grupta güncellik süresi aşıldı/);
  assert.doesNotMatch(basbug, /BMW/);
  const seta = render(<SupplierHealthStatus health={health([scope("seta", "ALL", { consecutive_failures: 2 })])} supplier="seta" name="SETA" unit="liste" refresh={refresh} refreshDescription="x"/>);
  assert.match(seta, /SETA güncellemeleri yeniden deneme bekliyor/);
  assert.match(seta, /Listeyi yeniden dene/);
  assert.doesNotMatch(seta, /<select/);
});

test("a silent scheduler over current data is an informational notice, not a warning", () => {
  const silent = { ...health([scope("basbug", "FIAT")]), heartbeat: { started_at: now, finished_at: now, succeeded: true, alive: false } };
  const html = render(<SupplierHealthStatus health={silent} supplier="basbug" name="Başbuğ" unit="grup" warehouse="MRK" refresh={refresh} refreshField="group" refreshDescription="x"/>);
  assert.match(html, /Otomatik güncelleme çalışmıyor/);
  assert.match(html, /bg-info-subtle/);
  // Some but not all scopes past their SLA read "kısmen güncel", the overview's word.
  const partial = render(<SupplierHealthStatus health={health([scope("basbug", "FIAT", { catalog_stale: true }), scope("basbug", "BMW")])} supplier="basbug" name="Başbuğ" unit="grup" warehouse="MRK" refresh={refresh} refreshField="group" refreshDescription="x"/>);
  assert.match(partial, /Başbuğ verileri kısmen güncel; güncelleme gerekiyor/);
});

test("the health body reports open price anomalies without changing the status (#1049)", () => {
  const healthy = { ...health([scope("basbug", "FIAT")]), healthy: true };
  assert.deepEqual([supplierHealthBody(healthy, 7).status, supplierHealthBody(healthy, 7).body.status, supplierHealthBody(healthy, 7).body.open_price_anomalies], [200, "ok", 7]);
  assert.equal(supplierHealthBody(healthy, null).status, 200);
  assert.equal(supplierHealthBody(healthy, null).body.open_price_anomalies, null);
  const unhealthy = health([scope("basbug", "FIAT", { catalog_stale: true })]);
  for (const open of [0, 7, null]) assert.deepEqual([supplierHealthBody(unhealthy, open).status, supplierHealthBody(unhealthy, open).body.status], [503, "degraded"]);
});

test("the quality card adds a price anomaly figure that links to the page's group", () => {
  const quality = { uniqueProducts: 10, productRows: 10, missingPrices: 0, duplicateCodes: 0, conflictingCodes: 0 };
  const some = render(<SupplierQualityCard quality={quality} filters={{ group: "OTHER" }} priceAnomalies={{ open: 2, filters: { group: "FIAT" } }}/>);
  assert.match(some, /Fiyat anomalisi/);
  assert.match(some, /href="\?group=FIAT&amp;quality=price-anomaly"/);
  const none = render(<SupplierQualityCard quality={quality} priceAnomalies={{ open: 0 }}/>);
  assert.match(none, /Fiyat anomalisi/);
  assert.doesNotMatch(none, /price-anomaly/);
  assert.match(none, /Sorun yok/);
  assert.doesNotMatch(render(<SupplierQualityCard quality={quality}/>), /Fiyat anomalisi/);
});
