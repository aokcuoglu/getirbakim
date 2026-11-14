import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { SupplierHealthStatus } from "../src/components/admin/supplier-health-status";
import type { SupplierHealthScope } from "../src/modules/suppliers/health";

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
  assert.match(html, /Dinamik verilerinin güncellenmesi gerekiyor/);
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
