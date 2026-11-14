import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { restockRequestSchema } from "../src/modules/store/restock-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// "Gelince haber ver" requests (#475) in an isolated copy of the schema; nothing touches the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let requests: typeof import("../src/modules/store/restock-requests");
let admin: typeof import("../src/modules/admin/restock");
let closeDb: () => Promise<void>;
let dropped = "", sold = "", adminId = "";
const basbug = storefrontCompanies()[0];
const form = (changes: Record<string, unknown> = {}) => ({ productId: dropped, email: " Musteri@Example.invalid ", consent: "on", website: "", ...changes });

async function item(code: string, presence: string, group: string) {
  return (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,$2,'MRK',$3,'{"uk":"MANN","ac":"YAG FILTRESI","dc":"TL"}','{"nf":100}','{"stok":1}',1,1,1,$4,now(),now(),now()) RETURNING id::text`,
  [basbug, group, code, presence])).rows[0].id;
}

before(async () => {
  schema = await isolatedSchema("restock_test");
  dropped = await item("MAN W712", "inactive", "G1");
  sold = await item("MAN W719", "present", "G1");
  adminId = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Test','admin@example.invalid','x','admin',true) RETURNING id::text")).rows[0].id;
  const [{ db }, store, workspace] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/restock-requests"), import("../src/modules/admin/restock")]);
  requests = store; admin = workspace;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const rows = async () => (await schema.pool.query("SELECT * FROM restock_requests ORDER BY requested_at")).rows;

test("the form needs a product id, a valid address and the explicit consent; bots fill the hidden field", () => {
  assert.equal(restockRequestSchema.parse(form({ productId: "00000000-0000-4000-8000-000000000000" })).email, "musteri@example.invalid");
  for (const change of [{ productId: "x" }, { email: "invalid" }, { email: "a".repeat(255) + "@example.invalid" }, { consent: undefined }, { consent: "off" }, { website: "spam" }])
    assert.equal(restockRequestSchema.safeParse(form({ productId: "00000000-0000-4000-8000-000000000000", ...change })).success, false, JSON.stringify(change));
});

test("a request is stored once per address and product, only for a product nobody sells", async () => {
  assert.equal((await requests.createRestockRequest(form(), { ip: "192.0.2.1" })).status, "success");
  assert.equal((await requests.createRestockRequest(form({ email: "musteri@example.invalid" }), { ip: "192.0.2.1" })).status, "success");
  const stored = await rows();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].email, "musteri@example.invalid");
  assert.equal(stored[0].supplier_item_id, dropped);
  assert.equal(stored[0].code, "MAN W712");
  assert.equal(stored[0].status, "pending");
  assert.match(stored[0].consent_text, /bir kez bilgilendirme/);
  // A saleable product, an unknown id and a bot are refused without a row.
  assert.equal((await requests.createRestockRequest(form({ productId: sold }))).status, "error");
  assert.equal((await requests.createRestockRequest(form({ productId: "00000000-0000-4000-8000-000000000000" }))).status, "error");
  assert.equal((await requests.createRestockRequest(form({ website: "x" }))).status, "error");
  assert.equal((await rows()).length, 1);
  // Rate limit per address: 5 an hour.
  for (let attempt = 0; attempt < 3; attempt++) await requests.createRestockRequest(form());
  assert.equal((await requests.createRestockRequest(form())).status, "error");
  await schema.pool.query("DELETE FROM restock_request_attempts");
});

test("an open request becomes 'Bildirilecek' when its product can be ordered again, then is marked notified", async () => {
  let list = await admin.loadRestockRequests("pending");
  assert.equal(list.rows[0].offer_id, null);
  assert.equal(await admin.restockDueCount(), 0);
  // Başbuğ lists the code again under another list group: same supplier + code.
  const back = await item("MAN W712", "present", "G2");
  list = await admin.loadRestockRequests("pending");
  assert.equal(list.rows[0].offer_id, back);
  assert.equal(list.rows[0].offer_price_kurus, 15600);
  assert.equal(await admin.restockDueCount(), 1);
  assert.equal(await admin.markRestockNotified([list.rows[0].id], adminId), 1);
  assert.equal(await admin.markRestockNotified([list.rows[0].id], adminId), 0);
  list = await admin.loadRestockRequests("notified");
  assert.equal(list.rows.length, 1);
  assert.ok(list.rows[0].notified_at);
  assert.deepEqual(list.counts, { pending: 0, notified: 1 });
  assert.equal(await admin.restockDueCount(), 0);
  // A product grouped with another row: the group's saleable member counts too.
  await schema.pool.query("UPDATE supplier_items SET presence='inactive' WHERE id=$1", [back]);
  const other = await item("MAN W712-2", "inactive", "G3");
  await schema.pool.query("INSERT INTO products(id,brand,part_number,name,brand_label,code) VALUES($1,'MANN','W7122','F','MANN','MAN W712-2')", [other]);
  await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1)", [other]);
  assert.equal((await requests.createRestockRequest(form({ productId: other }))).status, "success");
  assert.equal((await rows()).find(row => row.supplier_item_id === other)?.product_id, other);
  assert.equal(await admin.restockDueCount(), 0);
  await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [sold, other]);
  assert.equal((await admin.loadRestockRequests("pending")).rows[0].offer_id, sold);
  assert.equal(await admin.restockDueCount(), 1);
  await schema.pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [sold]);
});

test("retention: notified after 30 days, pending after 12 months, withdrawn at once", async () => {
  await schema.pool.query("DELETE FROM restock_requests");
  const insert = (status: string, requested: string, notified: string | null) => schema.pool.query(`INSERT INTO restock_requests(email,supplier,code,brand,name,consent_text,consent_version,status,requested_at,notified_at)
    VALUES($1,'basbug','X','B','N','c','v',$2,now()-$3::interval,now()-$4::interval)`, [`${status}${requested}${notified}@example.invalid`, status, requested, notified]);
  await insert("notified", "40 days", "31 days");
  await insert("notified", "40 days", "29 days");
  await insert("pending", "13 months", null);
  await insert("pending", "11 months", null);
  await insert("withdrawn", "1 day", null);
  await schema.pool.query("INSERT INTO restock_request_attempts(key,window_start) VALUES('old',now()-interval '2 days'),('new',now())");
  const { rows: [{ pruned }] } = await schema.pool.query("SELECT prune_restock_requests() AS pruned");
  assert.deepEqual(pruned, { notified: 1, pending: 1, withdrawn: 1, attempts: 1 });
  assert.deepEqual((await schema.pool.query("SELECT status FROM restock_requests ORDER BY status")).rows.map(row => row.status), ["notified", "pending"]);
  // The status and notice time agree.
  await assert.rejects(schema.pool.query("UPDATE restock_requests SET notified_at=NULL WHERE status='notified'"));
});
