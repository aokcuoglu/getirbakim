import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { BasbugImportError, importBasbug } from "../src/modules/suppliers/basbug-import";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const base = process.env.VERIFY_URL || "http://localhost:3100";
const tokens = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
const hashes = tokens.map(t => createHash("sha256").update(t).digest("hex"));
let serviceId: string | undefined;
async function get(path: string, role?: number) {
  return fetch(base + path, { headers: role === undefined ? {} : { cookie: `gb_session=${tokens[role]}` }, redirect: "manual" });
}
try {
  const admin = await pool.query("SELECT id FROM accounts WHERE role='admin' AND approved ORDER BY email LIMIT 1");
  assert.ok(admin.rows[0], "Administrator required");
  serviceId = (await pool.query("INSERT INTO accounts (name,email,password_hash,role,approved) VALUES ('Supplier verification',$1,'unused-test-hash','service',true) RETURNING id", [`verify-supplier-${randomBytes(8).toString("hex")}@example.invalid`])).rows[0].id;
  for (const [index, account] of [admin.rows[0].id, serviceId].entries()) await pool.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '10 minutes')", [hashes[index], account]);
  const route = "/yonetim/tedarikciler/basbug";
  const anonymous = await get(route); assert.equal(anonymous.status, 307); assert.equal(anonymous.headers.get("location"), "/giris");
  const service = await get(route, 1); assert.equal(service.status, 307); assert.equal(service.headers.get("location"), "/");
  const response = await get(route, 0); assert.equal(response.status, 200);
  const snapshot = (await pool.query("SELECT quality FROM supplier_imports WHERE list_group='FIAT' AND warehouse='MRK' AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1")).rows[0];
  assert.ok(snapshot, "A live FIAT/MRK import is required");
  const html = await response.text(); assert.ok(html.includes(Number(snapshot.quality.uniqueProducts).toLocaleString("tr-TR"))); assert.ok(html.includes("MRK sinyali"));
  const search = await (await get(`${route}?q=COR%2082016529`, 0)).text();
  assert.ok(search.includes("COR 82016529")); assert.ok(search.includes("46404094")); assert.ok(search.includes("3,01"));
  const detailPath = search.match(/href="(\/yonetim\/tedarikciler\/basbug\/urun\/[a-f0-9-]+)"/)?.[1]; assert.ok(detailPath);
  assert.equal((await get(detailPath)).status, 307); assert.equal((await get(detailPath, 1)).status, 307);
  const detail = await (await get(detailPath, 0)).text(); assert.ok(detail.includes("KRANK KECESI ON")); assert.ok(detail.includes("Model açıklaması"));
  const oem = await (await get(`${route}?q=46404094&brand=CORTECO&currency=EUR`, 0)).text(); assert.ok(oem.includes("COR 82016529"));
  const missing = await (await get(`${route}?quality=missing-price`, 0)).text(); assert.ok(missing.replace(/<!--.*?-->/g, "").includes(`${Number(snapshot.quality.missingPrices).toLocaleString("tr-TR")} ürün`));
  if (snapshot.quality.missingPrices) assert.ok(missing.includes("Fiyat eksik"));
  const empty = await (await get(`${route}?q=__NO_SUCH_SUPPLIER_CODE__`, 0)).text(); assert.ok(empty.includes("Filtrelere uygun ürün bulunamadı"));
  assert.ok((await (await get(`${route}?group=UNIMPORTED_TEST`, 0)).text()).includes("Bu grubun verileri henüz çekilmedi"));
  assert.ok((await (await get(`${route}?page=2`, 0)).text()).replace(/<!--.*?-->/g, "").includes("Sayfa 2 /"));
  assert.ok(detail.includes("Değişiklik geçmişi"));
  assert.ok(html.includes("Senkronizasyon durumu"));
  assert.ok(!(await (await get("/katalog?q=COR%2082016529")).text()).includes("KRANK KECESI ON"), "Supplier observations must not publish to storefront");
  const form = new FormData();
  const refreshForm = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => m[1]).find(f => f.includes("API’den güncelle") && f.includes('name="group"'));
  assert.ok(refreshForm);
  const action = refreshForm.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1]; assert.ok(action); form.set(action, ""); form.set("group", "INVALID!");
  const unauthorizedAction = await fetch(base + route, { method: "POST", headers: { origin: base, cookie: `gb_session=${tokens[1]}` }, body: form, redirect: "manual" });
  assert.equal(unauthorizedAction.status, 303); assert.equal(unauthorizedAction.headers.get("location"), "/");
  const invalid = await fetch(base + route, { method: "POST", headers: { origin: base, cookie: `gb_session=${tokens[0]}` }, body: form, redirect: "manual" });
  assert.equal(invalid.status, 303); assert.ok(invalid.headers.get("location")?.includes("error=contract"));
  const foreign = await fetch(base + route, { method: "POST", headers: { origin: "https://invalid-origin.example", cookie: `gb_session=${tokens[0]}` }, body: form, redirect: "manual" });
  assert.ok(foreign.status >= 400, "Cross-origin actions must be rejected");
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(20261001,1)");
    await assert.rejects(importBasbug(pool, { group: "FIAT", warehouse: "MRK" }), error => error instanceof BasbugImportError && error.reason === "busy");
  } finally { await lock.query("SELECT pg_advisory_unlock(20261001,1)"); lock.release(); }
  console.log("Başbuğ admin: access control, actions/CSRF, search/OEM/filters, pagination/detail, private catalog boundary, change history and import lock verified.");
} finally {
  await pool.query("DELETE FROM sessions WHERE token_hash=ANY($1::text[])", [hashes]);
  if (serviceId) await pool.query("DELETE FROM accounts WHERE id=$1", [serviceId]);
  await pool.end();
}
