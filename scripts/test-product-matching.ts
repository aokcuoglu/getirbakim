import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool, type PoolClient } from "pg";
import { bulkAcceptableSql, manualDeciderSql, manualKindFilterSql, manualKindSql, multiNumberCandidateSql, offerManualSql, sharedCandidateSql } from "../src/modules/admin/product-matching-sql";

// Pure SQL helpers from db/product-matching.sql (applied by db:setup); runs against the local database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());
const one = async (sql: string, values: unknown[]) => (await pool.query(sql, values)).rows[0].value;
const part = (supplier: string, code: string, data: object) => one("SELECT supplier_item_part_number($1,$2,$3) AS value", [supplier, code, JSON.stringify(data)]);
const brand = (value: string) => one("SELECT product_brand_key($1) AS value", [value]);

test("supplier prefixes are dropped; original parts and SETA keep the whole code", async () => {
  assert.equal(await part("basbug", "MANN W 712/95", { uk: "MANN" }), "W71295");
  assert.equal(await part("dinamik", "MANN W712/95", { marka: "MANN" }), "W71295");
  assert.equal(await part("basbug", "BK21 60762 BC35B8", { uk: "OE-FD" }), "BK2160762BC35B8");
  assert.equal(await part("dinamik", "PSA-E 1574.W2", { marka: "PSA ORIJINAL" }), "1574W2");
  assert.equal(await part("seta", "TRA SET 1", { uk: "SETA" }), "TRASET1");
});

test("brand keys ignore spelling and fold original-equipment labels together", async () => {
  assert.equal(await brand("MEAT & DORIA"), await brand("MEAT&DORIA"));
  assert.equal(await brand("BOSCH-AV"), "BOSCH");
  for (const label of ["OE-PSA", "IOE-HYU", "PSA ORIJINAL", "ORJINAL", "OPAR", "GM"]) assert.equal(await brand(label), "ORIJINAL", label);
  assert.equal(await brand("MAHLE FILTRE"), "MAHLEFILTRE"); // left to brand-pair review, not guessed
  assert.equal(await brand("  "), null);
});

test("names come from each supplier's own field", async () => {
  assert.equal(await one("SELECT supplier_item_name('dinamik',$1) AS value", [JSON.stringify({ stokAdi: "ROT BASI" })]), "ROT BASI");
  assert.equal(await one("SELECT supplier_item_name('basbug',$1) AS value", [JSON.stringify({ ac: "" })]), null);
});

test("candidate names conflict only when they name different kinds of part", async () => {
  const conflict = (a: string, b: string | null) => one("SELECT product_names_conflict($1,$2) AS value", [a, b]);
  assert.equal(await conflict("EL FREN TEL KLIPSI", "MOTOR SUBAP TAKIMI MEGANE II 2003>2005"), true);
  assert.equal(await conflict("SANZUMAN YAG FILTRESI", "ARKA AMORTISOR FOCUS II 05> 11 STATION WAGON"), true);
  assert.equal(await conflict("DIS DIKIZ AYNASI SOL", "DIS DIKIZ AYNA SOL MEKANIK DACIA DUSTER 18>"), false);
  assert.equal(await conflict("TRIGER SETI", "EKSANTRIK GERGI KITI (146x240) ASTRA G H J"), false); // synonyms
  assert.equal(await conflict("PORYA ARKA", "ARKA TEKER RULMANI 4 BIJON ABSLI KANGOO"), false);
  assert.equal(await conflict("SUPAPKAPAGICONTASI", "SUPAP KAPAK CONTASI MERCEDES W123"), false); // glued words
  assert.equal(await conflict("CAM SU MOTORU", "SILECEK SU FISKIYE MOTORU ON"), false);
  assert.equal(await conflict("MOTOR TAKOZU", "ALTERNATOR GERGI RULMANI R9M MOTOR"), true); // MOTOR alone is no part type
  assert.equal(await conflict("ÖN FREN BALATASI", "FREN BALATASI ARKA"), false);
  assert.equal(await conflict("ARKA SAG", "AMORTISOR"), false); // nothing to compare
  assert.equal(await conflict("TERMOSTAT", null), false);
});

test("OEM numbers split on , ; / but keep Ford-style spaces; short fragments are dropped", async () => {
  const oems = (supplier: string, data: object) => one("SELECT supplier_item_oem_numbers($1,$2) AS value", [supplier, JSON.stringify(data)]);
  assert.deepEqual(await oems("basbug", { oe: "6C11 2282 EB" }), ["6C112282EB"]);
  assert.deepEqual(await oems("basbug", { oe: "4254.69 / 1611140880; 3M5Q 9F593 /SET" }), ["1611140880", "3M5Q9F593", "425469"]);
  assert.deepEqual(await oems("seta", { oems: ["25500-2B000"], oe: "ignored for SETA" }), ["255002B000"]);
  assert.deepEqual(await oems("dinamik", { oe: "1234567" }), []);
});

test("only check-digit-valid GTINs count as barcodes", async () => {
  const gtin = (code: string) => one("SELECT gtin_valid($1) AS value", [code]);
  assert.equal(await gtin("5414465978258"), true);
  assert.equal(await gtin("5414465978259"), false);
  assert.equal(await gtin("1617975680"), false); // OEM number stored in a barcode field
  assert.equal(await gtin("0000000000000"), false);
});

test("offer groups are listed under the Başbuğ item and never contain SETA or split items", async () => {
  const count = (sql: string) => one(`SELECT count(*)::int AS value FROM ${sql}`, []);
  assert.equal(await count(`product_offers o JOIN supplier_items p ON p.id=o.primary_id JOIN supplier_items i ON i.id=o.item_id
    WHERE i.supplier='basbug' AND p.supplier<>'basbug'`), 0);
  assert.equal(await count("product_offers o JOIN supplier_items i ON i.id=o.item_id WHERE i.supplier='seta'"), 0);
  // Every offer group is exactly one master product.
  assert.equal(await count(`product_offers o JOIN product_sources a ON a.supplier_item_id=o.item_id
    JOIN product_sources b ON b.supplier_item_id=o.primary_id WHERE a.product_id<>b.product_id`), 0);
});

test("master products: one automatic product per key, symmetric equivalents", async () => {
  const count = (sql: string) => one(`SELECT count(*)::int AS value FROM ${sql}`, []);
  assert.equal(await count(`product_sources s JOIN product_match_items m ON m.supplier_item_id=s.supplier_item_id
    JOIN products p ON p.id=s.product_id WHERE s.method='auto' AND (p.brand,p.part_number,p.variant)<>(m.brand,m.part_number,0)`), 0);
  assert.equal(await count(`product_sources s JOIN products p ON p.id=s.product_id WHERE s.method='manual' AND p.variant=0`), 0);
  assert.equal(await count(`product_equivalents e WHERE NOT EXISTS (SELECT 1 FROM product_equivalents r
    WHERE r.product_id=e.equivalent_id AND r.equivalent_id=e.product_id)`), 0);
});

test("equivalent decisions: hand-made links survive refreshes, unrelated pairs and HD suffixes follow the decision", async () => {
  const count = (sql: string) => one(`SELECT count(*)::int AS value FROM ${sql}`, []);
  const linked = (a: string, b: string) => `EXISTS (SELECT 1 FROM product_equivalents e WHERE e.product_id=${a} AND e.equivalent_id=${b})`;
  assert.equal(await count(`product_equivalent_decisions d WHERE d.status='equivalent' AND NOT ${linked("d.product_a", "d.product_b")}`), 0);
  assert.equal(await count(`product_equivalent_decisions d WHERE d.status='unrelated' AND (${linked("d.product_a", "d.product_b")} OR ${linked("d.product_b", "d.product_a")})`), 0);
  // DAYCO 10PK1725HD is the same size as ABA / CONTITECH 10PK1725 once the pair is decided equivalent.
  assert.equal(await count(`product_brand_pair_decisions d
    JOIN products a ON a.brand IN (d.brand_a,d.brand_b) AND a.variant=0 AND length(a.part_number)>=5
    JOIN products b ON b.brand IN (d.brand_a,d.brand_b) AND b.brand<>a.brand AND b.variant=0 AND b.part_number=a.part_number||'HD'
    WHERE d.status='equivalent' AND NOT ${linked("a.id", "b.id")} AND NOT EXISTS (SELECT 1 FROM product_equivalent_decisions x
      WHERE x.status='unrelated' AND x.product_a=LEAST(a.id,b.id) AND x.product_b=GREATEST(a.id,b.id))`), 0);
});

test("a split row gets its own locked product and rejoins on undo", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pick = (await client.query<{ item: string; product: string }>(`SELECT s.supplier_item_id AS item, s.product_id AS product
      FROM product_sources s JOIN products p ON p.id=s.product_id AND p.variant=0
      WHERE s.method='auto' AND s.supplier_item_id<>s.product_id LIMIT 1`)).rows[0];
    assert.ok(pick, "expected a product with more than one source");
    const split = (await client.query<{ id: string }>("SELECT product_split_item($1,NULL) AS id", [pick.item])).rows[0].id;
    assert.notEqual(split, pick.product);
    const link = (await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [pick.item])).rows[0];
    assert.deepEqual(link, { product_id: split, method: "manual" });
    assert.ok((await client.query("SELECT variant FROM products WHERE id=$1", [split])).rows[0].variant > 0);
    assert.equal((await client.query("SELECT product_reset_item($1) AS id", [pick.item])).rows[0].id, pick.product);
    assert.deepEqual((await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [pick.item])).rows[0],
      { product_id: pick.product, method: "auto" });
    assert.equal((await client.query("SELECT merged_into FROM products WHERE id=$1", [split])).rows[0].merged_into, pick.product);
    // Undoing a split returns the row to its own key: no pair to block.
    assert.equal((await client.query("SELECT count(*)::int AS n FROM product_match_decisions WHERE product_a=$1 AND product_b=$2", [split, pick.product])).rows[0].n, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("manual decisions show who decided and the kind filter keeps only that kind", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pick = (await client.query<{ item: string }>(`SELECT s.supplier_item_id AS item FROM product_sources s
      JOIN products p ON p.id=s.product_id AND p.variant=0 WHERE s.method='auto' AND s.supplier_item_id<>s.product_id LIMIT 1`)).rows[0];
    assert.ok(pick, "expected a product with more than one source");
    const actor = (await client.query<{ id: string }>(
      "INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Karar Veren Test','karar-veren-test@example.invalid','x','admin',true) RETURNING id")).rows[0].id;
    await client.query("SELECT product_split_item($1,$2)", [pick.item, actor]);
    const list = async (kind: boolean | null) => (await client.query<{ id: string; kind: string; by: string | null }>(`SELECT i.id,${manualKindSql} AS kind,${manualDeciderSql} AS by
      FROM product_sources x JOIN supplier_items i ON i.id=x.supplier_item_id JOIN products p ON p.id=x.product_id LEFT JOIN accounts a ON a.id=x.decided_by
      WHERE x.method='manual' AND ${manualKindFilterSql("$1")}`, [kind])).rows;
    const mine = <T extends { id: string }>(rows: T[]) => rows.filter(row => row.id === pick.item);
    assert.deepEqual(mine(await list(null)), [{ id: pick.item, kind: "split", by: "Karar Veren Test" }]);
    assert.equal(mine(await list(true)).length, 1);
    assert.equal(mine(await list(false)).length, 0);
    assert.ok((await list(true)).every(row => row.kind === "split"));
    assert.ok((await list(false)).every(row => row.kind === "merge"));
    // Without a name the e-mail stands in; decisions without an actor have no name.
    await client.query("UPDATE accounts SET name='' WHERE id=$1", [actor]);
    assert.equal(mine(await list(null))[0].by, "karar-veren-test@example.invalid");
    await client.query("UPDATE product_sources SET decided_by=NULL WHERE supplier_item_id=$1", [pick.item]);
    assert.equal(mine(await list(null))[0].by, null);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("merging a candidate locks the rows into the Başbuğ product; resetting a row undoes it and blocks the pair", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pair = (await client.query<{ a: string; b: string }>(`SELECT product_a AS a, product_b AS b FROM product_match_candidates LIMIT 1`)).rows[0];
    assert.ok(pair, "expected at least one match candidate");
    const items = (await client.query<{ id: string }>("SELECT supplier_item_id AS id FROM product_sources WHERE product_id=$1", [pair.b])).rows.map(row => row.id);
    await client.query("INSERT INTO product_match_decisions(product_a,product_b,status) VALUES($1,$2,'same')", [pair.a, pair.b]);
    assert.equal((await client.query("SELECT product_merge($2,$1,NULL) AS id", [pair.a, pair.b])).rows[0].id, pair.a);
    const moved = (await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=ANY($1::uuid[])", [items])).rows;
    assert.ok(moved.every(row => row.product_id === pair.a && row.method === "manual"));
    const merged = (await client.query("SELECT merged_into FROM products WHERE id=$1", [pair.b])).rows[0].merged_into;
    assert.equal(merged, pair.a);
    assert.deepEqual((await client.query("SELECT suppliers FROM products WHERE id=$1", [pair.a])).rows[0].suppliers, ["basbug", "dinamik"]);
    assert.equal((await client.query("SELECT product_reset_item($1) AS id", [items[0]])).rows[0].id, pair.b);
    assert.equal((await client.query("SELECT merged_into FROM products WHERE id=$1", [pair.b])).rows[0].merged_into, null);
    assert.equal((await client.query("SELECT status FROM product_match_decisions WHERE product_a=$1 AND product_b=$2", [pair.a, pair.b])).rows[0].status, "different");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("matched group offers flag the rows linked by hand", async t => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pair = (await client.query<{ a: string; b: string }>(`SELECT a.id AS a, b.id AS b FROM products a JOIN products b ON b.id>a.id AND b.variant=0 AND b.merged_into IS NULL
      WHERE a.variant=0 AND a.merged_into IS NULL
        AND EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=a.id) AND EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=b.id)
        AND NOT EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id IN (a.id,b.id) AND s.method<>'auto') LIMIT 1`)).rows[0];
    if (!pair) return t.skip("no two products to merge");
    const moved = (await client.query<{ id: string }>("SELECT supplier_item_id AS id FROM product_sources WHERE product_id=$1", [pair.b])).rows.map(row => row.id);
    assert.ok(moved.length);
    assert.ok((await client.query("SELECT product_merge($2,$1,NULL) AS id", [pair.a, pair.b])).rows[0].id);
    const flags = async () => new Map((await client.query<{ id: string; manual: boolean }>(`WITH offers AS (SELECT s.supplier_item_id AS id FROM product_sources s WHERE s.product_id=$1)
      SELECT id, ${offerManualSql} AS manual FROM offers`, [pair.a])).rows.map(row => [row.id, row.manual]));
    const merged = await flags();
    assert.ok(moved.every(id => merged.get(id) === true));
    assert.ok([...merged].filter(([id]) => !moved.includes(id)).every(([, manual]) => manual === false));
    await client.query("SELECT product_reset_item($1)", [moved[0]]);
    assert.equal((await flags()).get(moved[0]), undefined);
    assert.equal((await client.query<{ manual: boolean }>(`WITH offers AS (SELECT $1::uuid AS id) SELECT ${offerManualSql} AS manual FROM offers`, [moved[0]])).rows[0].manual, false);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// A merge made without a decision row (older merges, "Aynı ürün" from the product page) is still blocked on undo (#551).
test("undoing a merge without a decision row records the pair as different in candidate direction", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<{ product: string }>(`SELECT s.product_id AS product FROM product_sources s
      JOIN products p ON p.id=s.product_id AND p.variant=0 AND p.merged_into IS NULL
      JOIN commerce_supplier_items i ON i.id=s.supplier_item_id AND i.supplier='basbug' WHERE s.method='auto' LIMIT 1`)).rows[0];
    assert.ok(group, "expected a Başbuğ product");
    const single = (await client.query<{ item: string; product: string }>(`SELECT s.supplier_item_id AS item, s.product_id AS product FROM product_sources s
      JOIN products p ON p.id=s.product_id AND p.variant=0 AND p.merged_into IS NULL AND p.suppliers='{dinamik}'
      WHERE s.method='auto' AND s.product_id<>$1
       AND NOT EXISTS (SELECT 1 FROM product_sources t WHERE t.product_id=s.product_id AND t.supplier_item_id<>s.supplier_item_id) LIMIT 1`,
      [group.product])).rows[0];
    assert.ok(single, "expected a Dinamik-only product");
    const actor = (await client.query<{ id: string }>("SELECT id FROM accounts LIMIT 1")).rows[0]?.id ?? null;
    await client.query("DELETE FROM product_match_decisions WHERE (product_a,product_b) IN (($1,$2),($2,$1))", [group.product, single.product]);
    assert.equal((await client.query("SELECT product_merge($1,$2,NULL) AS id", [single.product, group.product])).rows[0].id, group.product);
    assert.equal((await client.query("SELECT product_reset_item($1,$2) AS id", [single.item, actor])).rows[0].id, single.product);
    const decision = (await client.query("SELECT status,decided_by FROM product_match_decisions WHERE product_a=$1 AND product_b=$2",
      [group.product, single.product])).rows[0];
    assert.deepEqual(decision, { status: "different", decided_by: actor });
    assert.equal((await client.query("SELECT count(*)::int AS n FROM product_match_decisions WHERE product_a=$1 AND product_b=$2",
      [single.product, group.product])).rows[0].n, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// Runs the candidate passes of refresh_product_matches() as installed, limited to the products in `candidate_fixture`
// (a full refresh takes minutes). Only the product scans are narrowed; the pairing and decision checks are the real ones.
const runCandidatePasses = async (client: PoolClient) => {
  const source = (await client.query<{ def: string }>("SELECT pg_get_functiondef('refresh_product_matches()'::regprocedure) AS def")).rows[0].def;
  const loop = source.match(/FOR pairing IN 1\.\.2 LOOP[\s\S]*?END LOOP;/)?.[0];
  assert.ok(loop, "candidate passes not found in refresh_product_matches()");
  const scan = "FROM products WHERE merged_into IS NULL";
  assert.equal(loop.split(scan).length - 1, 2, "expected the two product scans of the candidate passes");
  const scoped = loop.replaceAll(scan, "FROM products WHERE id IN (SELECT id FROM candidate_fixture) AND merged_into IS NULL");
  await client.query(`DO $gen$ DECLARE pairing integer; BEGIN ${scoped} END $gen$`);
  return (await client.query<{ a: string; b: string; reason: string }>(`SELECT product_a AS a, product_b AS b, reason FROM product_match_candidates
    WHERE product_a IN (SELECT id FROM candidate_fixture) ORDER BY reason, product_a, product_b`)).rows;
};

test("a 'different' decision blocks the pair in either direction, including a manual list product merged by hand", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const product = async (part: string, supplier: string) => (await client.query<{ id: string }>(`INSERT INTO products(brand,part_number,name,brand_label,code,suppliers)
      VALUES ('ZZ551TEST',$1,'TEST PARCA','ZZ551TEST',$1,ARRAY[$2]) RETURNING id`, [part, supplier])).rows[0].id;
    // Başbuğ 0551001, Dinamik 551001 and manual 00551001 are leading-zero matches of each other.
    const basbug = await product("0551001", "basbug"), dinamik = await product("551001", "dinamik"), manual = await product("00551001", "manual");
    await client.query("CREATE TEMP TABLE candidate_fixture ON COMMIT DROP AS SELECT unnest($1::uuid[]) AS id", [[basbug, dinamik, manual]]);
    const pairs = (rows: { a: string; b: string }[]) => rows.map(row => `${row.a}>${row.b}`).sort();
    // Without decisions: Başbuğ↔Dinamik (pass 1), and the manual product with both API products (pass 2, manual as b).
    assert.deepEqual(pairs(await runCandidatePasses(client)), [`${basbug}>${dinamik}`, `${basbug}>${manual}`, `${dinamik}>${manual}`].sort());
    await client.query("DELETE FROM product_match_candidates WHERE product_a IN (SELECT id FROM candidate_fixture)");
    // Recorded in candidate direction (Başbuğ first), and the reverse of a pass-2 pair: the Dinamik product merged into
    // the manual one from the product page and undone, as product_reset_item records it (a = merged into).
    await client.query(`INSERT INTO product_match_decisions(product_a,product_b,status) VALUES ($1,$2,'different'),($3,$2,'different')`,
      [basbug, dinamik, manual]);
    assert.deepEqual(pairs(await runCandidatePasses(client)), [`${basbug}>${manual}`]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// Suffix endings known to name another part are never suggested (#534); reviewed safe ones may be merged in bulk
// (#535); ambiguous ones stay for a manual decision.
const installedDef = async (signature: string) =>
  (await pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [signature])).rows[0].def;
const assertSafeSuffixRules = async () => {
  assert.ok((await installedDef("product_suffix_verdict(text,text,text)")).includes("ORDINALITY")
    && (await installedDef("product_suffix_rules()")).includes("'same'"), "product_suffix_rules() predates #535; apply db/product-matching.sql from this branch");
};
const suffixVerdict = async (brand: string, a: string, b: string, client: Pool | PoolClient = pool) =>
  (await client.query<{ verdict: string | null }>("SELECT product_suffix_verdict($1,$2,$3) AS verdict", [brand, a, b])).rows[0].verdict;

test("known different-part suffix patterns get a 'different' verdict, reviewed safe ones 'same', the rest 'review'", async () => {
  await assertSafeSuffixRules();
  const different: [string, string, string][] = [
    ["FEBI", "100261", "1002610"], ["FEBI", "1007521", "100752"], ["TRW", "GDB328", "GDB3281"], ["TRW", "JTC4023", "JTC402"],
    ["BLUEPRINT", "ADG04319", "ADG043192"], ["MANN", "C25024", "C250241"], ["OSRAM", "64150CBN", "64150CBN2HB"],
    ["DAYCO", "KPV134", "KPV134HD"], ["GATES", "4PK970", "4PK970SF"], ["SILBAK", "SB2421C", "SB2421C2"], ["ORIJINAL", "425270", "42527025"],
    ["STONE", "JF36420", "JF364204"], ["ORIJINAL", "672007", "6720073"], ["OSRAM", "5007ULT2BL", "5007ULT"], ["OSRAM", "64150NBS", "64150NBS3BL"],
  ];
  const same: [string, string, string][] = [
    ["ORIJINAL", "KK21R19952BB5YZ", "KK21R19952BB5YZ9"], ["ORIJINAL", "BM51F31148AF3JA6", "BM51F31148AF3JA"],
    ["MAYSAN", "PN7210200", "PN7210200MM"], ["MAYSAN", "N7217004", "N7217004WM"], ["MAYSAN", "N6237601PM", "N6237601"],
    ["KENTPAR", "152T001", "152T00101"], ["GMB", "GH10280", "GH10280M"], ["GMB", "GH20030T", "GH20030"], ["GMB", "GH31585", "GH31585A"],
    ["STONE", "JF16443", "JF164431"], ["OSRAM", "64150NBS", "64150NBS1BL"], ["OSRAM", "5201DWP1BL", "5201DWP"],
  ];
  const review: [string, string, string][] = [
    ["DAYCO", "8PK1480", "8PK1480HD"], ["ORIJINAL", "KK21R19952BB5YX", "KK21R19952BB5YX9"], ["MAYSAN", "PN7210200", "PN7210200XM"],
    ["KENTPAR", "152A001", "152A00101"], ["GMB", "GH10280", "GH10280X"], ["SKF", "VKBA3010", "VKBA3010G"], ["SKF", "VKJA3010", "VKJA3010G"], ["ORIJINAL", "ZZ535AB5YZ", "ZZ535AB5YZ9"], ["STONE", "JFS30163RFCS", "JFS30163RFCS1"],
    ["ZZ535TEST", "ZZ535AB5YZ", "ZZ535AB5YZ9"],
  ];
  for (const [brand, a, b] of different) assert.equal(await suffixVerdict(brand, a, b), "different", `${brand} ${a} / ${b}`);
  for (const [brand, a, b] of same) assert.equal(await suffixVerdict(brand, a, b), "same", `${brand} ${a} / ${b}`);
  for (const [brand, a, b] of review) assert.equal(await suffixVerdict(brand, a, b), "review", `${brand} ${a} / ${b}`);
  assert.equal(await suffixVerdict("FEBI", "100261", "100262"), null);
  assert.equal(await suffixVerdict("FEBI", "100261", "100261"), null);
});

// No pair decided as different locally is called safe (#535); skipped where nothing has been decided yet.
test("no decided 'different' suffix pair gets a 'same' verdict", async t => {
  await assertSafeSuffixRules();
  const decided = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM product_match_decisions WHERE status='different'")).rows[0].n;
  if (!decided) return t.skip("no decisions in this database");
  const wrong = (await pool.query<{ pair: string }>(`SELECT a.brand||' '||a.part_number||' / '||b.part_number AS pair FROM product_match_decisions d
    JOIN products a ON a.id=d.product_a JOIN products b ON b.id=d.product_b
    WHERE d.status='different' AND a.brand=b.brand AND product_suffix_verdict(a.brand,a.part_number,b.part_number)='same'`)).rows.map(row => row.pair);
  assert.deepEqual(wrong, []);
});

// Overlapping rows (#535): brand rows before '*', then 'different' before 'review' before 'same', then row order. The
// rules are swapped inside a rolled-back transaction, so the installed list is untouched.
test("overlapping suffix rules resolve brand first, then the safer verdict", async () => {
  await assertSafeSuffixRules();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE OR REPLACE FUNCTION product_suffix_rules() RETURNS TABLE(brand text, base_pattern text, ext_pattern text, verdict text)
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ VALUES
       ('ZZ535','.','^9$','same'), ('ZZ535','5$','^9$','different'),
       ('*','.','^X$','different'), ('ZZ535','.','^X$','same'),
       ('ZZ535','.','^Y$','same'), ('ZZ535','.','^Y$','review'),
       ('*','.','^Z$','same'), ('*','.','^Z$','different') $$`);
    assert.equal(await suffixVerdict("ZZ535", "ZZ5355", "ZZ53559", client), "different", "'different' wins over an earlier 'same' row");
    assert.equal(await suffixVerdict("ZZ535", "ZZ5354", "ZZ53549", client), "same");
    assert.equal(await suffixVerdict("ZZ535", "ZZ5354", "ZZ5354X", client), "same", "a brand row wins over '*'");
    assert.equal(await suffixVerdict("OTHER", "ZZ5354", "ZZ5354X", client), "different");
    assert.equal(await suffixVerdict("ZZ535", "ZZ5354", "ZZ5354Y", client), "review", "'review' wins over 'same'");
    assert.equal(await suffixVerdict("OTHER", "ZZ5354", "ZZ5354Z", client), "different", "'different' wins within '*'");
    assert.equal(await suffixVerdict("ZZ535", "ZZ5354", "ZZ5354Q", client), "review", "no row: review");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("the candidate passes skip known different-part suffix pairs", async () => {
  const installed = (await pool.query<{ def: string }>("SELECT pg_get_functiondef('refresh_product_matches()'::regprocedure) AS def")).rows[0].def;
  assert.ok(installed.includes("product_suffix_verdict"), "refresh_product_matches() predates #534; run npm run db:setup from this branch");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const product = async (brand: string, part: string, supplier: string) => (await client.query<{ id: string }>(`INSERT INTO products(brand,part_number,name,brand_label,code,suppliers)
      VALUES ($1,$2,'TEST PARCA',$1,$2,ARRAY[$3]) RETURNING id`, [brand, part, supplier])).rows[0].id;
    const pair = async (brand: string, a: string, b: string) => ({ a: await product(brand, a, "basbug"), b: await product(brand, b, "dinamik") });
    const digit = await pair("ZZ534TEST", "5340261", "53402610");
    const colour = await pair("ZZ534TEST", "ZZ534AB5YZ", "ZZ534AB5YZ9");
    const box = await pair("OSRAM", "ZZ534CBN", "ZZ534CBN2HB");
    const bulb = await pair("OSRAM", "ZZ534NBS", "ZZ534NBS1BL");
    const stone = await pair("STONE", "ZZ53416443", "ZZ534164431");
    const zero = await pair("ZZ534TEST", "0534001", "534001");
    const all = [digit, colour, box, bulb, stone, zero].flatMap(({ a, b }) => [a, b]);
    await client.query("CREATE TEMP TABLE candidate_fixture ON COMMIT DROP AS SELECT unnest($1::uuid[]) AS id", [all]);
    const rows = (await runCandidatePasses(client)).map(row => `${row.a}>${row.b}:${row.reason}`).sort();
    const expected = [[colour, "suffix"], [bulb, "suffix"], [stone, "suffix"], [zero, "leading_zero"]] as const;
    assert.deepEqual(rows, expected.map(([{ a, b }, reason]) => `${a}>${b}:${reason}`).sort());
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// "Ayır" on one offer (#523): only that row leaves the group; the pair is recorded as different.
const groupWithAutoOffer = `SELECT o.item_id AS item, o.primary_id AS primary, s.product_id AS product FROM product_offers o
  JOIN product_sources s ON s.supplier_item_id=o.item_id AND s.method='auto'
  WHERE o.item_id<>o.primary_id AND (SELECT count(*) FROM product_offers g WHERE g.primary_id=o.primary_id)>=3 LIMIT 1`;

test("splitting one automatically grouped offer makes it a locked product; the rest of the group stays", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pick = (await client.query<{ item: string; primary: string; product: string }>(groupWithAutoOffer)).rows[0];
    assert.ok(pick, "expected an offer group of three or more with an automatic non-primary row");
    const others = (await client.query<{ item_id: string }>("SELECT item_id FROM product_offers WHERE primary_id=$1 AND item_id<>$2 ORDER BY item_id",
      [pick.primary, pick.item])).rows.map(row => row.item_id);
    const split = (await client.query<{ id: string }>("SELECT product_split_offer($1,$2,NULL) AS id", [pick.item, pick.primary])).rows[0].id;
    assert.ok(split);
    assert.notEqual(split, pick.product);
    assert.ok((await client.query("SELECT variant FROM products WHERE id=$1", [split])).rows[0].variant > 0);
    assert.deepEqual((await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [pick.item])).rows[0],
      { product_id: split, method: "manual" });
    assert.equal((await client.query("SELECT count(*)::int AS n FROM product_offers WHERE item_id=$1", [pick.item])).rows[0].n, 0);
    assert.deepEqual((await client.query<{ item_id: string }>("SELECT item_id FROM product_offers WHERE primary_id=$1 ORDER BY item_id", [pick.primary]))
      .rows.map(row => row.item_id), others);
    assert.equal((await client.query("SELECT status FROM product_match_decisions WHERE product_a=$1 AND product_b=$2", [pick.product, split])).rows[0]?.status, "different");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("splitting a hand-merged offer returns it to its own product and records the pair as different", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<{ item: string; primary: string; product: string }>(groupWithAutoOffer)).rows[0];
    assert.ok(group, "expected an offer group of three or more");
    // A saleable Dinamik row that is a product of its own and in no group: merged into the group by hand.
    const single = (await client.query<{ item: string; product: string }>(`SELECT s.supplier_item_id AS item, s.product_id AS product FROM product_sources s
      JOIN products p ON p.id=s.product_id AND p.variant=0 AND p.merged_into IS NULL
      WHERE s.method='auto' AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=s.supplier_item_id)
       AND EXISTS (SELECT 1 FROM commerce_supplier_items i WHERE i.id=s.supplier_item_id AND i.supplier='dinamik')
       AND EXISTS (SELECT 1 FROM product_match_items m WHERE m.supplier_item_id=s.supplier_item_id)
       AND NOT EXISTS (SELECT 1 FROM product_sources t WHERE t.product_id=s.product_id AND t.supplier_item_id<>s.supplier_item_id) LIMIT 1`)).rows[0];
    assert.ok(single, "expected a Dinamik-only product");
    const before = (await client.query<{ item_id: string }>("SELECT item_id FROM product_offers WHERE primary_id=$1 ORDER BY item_id", [group.primary]))
      .rows.map(row => row.item_id);
    assert.equal((await client.query("SELECT product_merge($1,$2,NULL) AS id", [single.product, group.product])).rows[0].id, group.product);
    assert.equal((await client.query("SELECT primary_id FROM product_offers WHERE item_id=$1", [single.item])).rows[0]?.primary_id, group.primary);
    assert.equal((await client.query("SELECT product_split_offer($1,$2,NULL) AS id", [single.item, group.primary])).rows[0].id, single.product);
    assert.deepEqual((await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [single.item])).rows[0],
      { product_id: single.product, method: "auto" });
    assert.equal((await client.query("SELECT merged_into FROM products WHERE id=$1", [single.product])).rows[0].merged_into, null);
    assert.equal((await client.query("SELECT status FROM product_match_decisions WHERE product_a=$1 AND product_b=$2", [group.product, single.product])).rows[0]?.status, "different");
    assert.deepEqual((await client.query<{ item_id: string }>("SELECT item_id FROM product_offers WHERE primary_id=$1 ORDER BY item_id", [group.primary]))
      .rows.map(row => row.item_id), before);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("a stale form does not split a row that has since moved to another group", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<{ item: string; primary: string; product: string }>(groupWithAutoOffer)).rows[0];
    assert.ok(group, "expected an offer group of three or more");
    // A Dinamik product of exactly two saleable rows, merged by hand into the group's product.
    const dinamik = (await client.query<{ product: string; items: string[] }>(`SELECT p.id AS product, array_agg(s.supplier_item_id ORDER BY s.supplier_item_id) AS items
      FROM products p JOIN product_sources s ON s.product_id=p.id
      WHERE p.variant=0 AND p.merged_into IS NULL AND p.suppliers='{dinamik}' AND s.method='auto'
       AND EXISTS (SELECT 1 FROM commerce_supplier_items i WHERE i.id=s.supplier_item_id)
       AND EXISTS (SELECT 1 FROM product_match_items m WHERE m.supplier_item_id=s.supplier_item_id)
      GROUP BY p.id HAVING count(*)=2 AND (SELECT count(*) FROM product_sources t WHERE t.product_id=p.id)=2 LIMIT 1`)).rows[0];
    assert.ok(dinamik, "expected a Dinamik product with two rows");
    assert.equal((await client.query("SELECT product_merge($1,$2,NULL) AS id", [dinamik.product, group.product])).rows[0].id, group.product);
    for (const item of dinamik.items) {
      assert.equal((await client.query("SELECT primary_id FROM product_offers WHERE item_id=$1", [item])).rows[0]?.primary_id, group.primary);
      assert.equal((await client.query("SELECT product_split_offer($1,$2,NULL) AS id", [item, group.primary])).rows[0].id, dinamik.product);
    }
    // Both rows are back on their own product, grouped again under one of them: the other is a non-primary offer there.
    const moved = (await client.query<{ item_id: string; primary_id: string }>("SELECT item_id,primary_id FROM product_offers WHERE item_id=ANY($1::uuid[]) AND item_id<>primary_id",
      [dinamik.items])).rows[0];
    assert.ok(moved, "expected the two rows grouped together again");
    assert.notEqual(moved.primary_id, group.primary);
    const state = () => client.query("SELECT s.product_id,s.method,o.primary_id FROM product_sources s LEFT JOIN product_offers o ON o.item_id=s.supplier_item_id WHERE s.supplier_item_id=$1",
      [moved.item_id]).then(result => result.rows[0]);
    const before = await state();
    assert.equal((await client.query("SELECT product_split_offer($1,$2,NULL) AS id", [moved.item_id, group.primary])).rows[0].id, null);
    assert.deepEqual(await state(), before);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("a manual row already on its own key's product is split into a locked variant", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pick = (await client.query<{ item: string; primary: string; product: string }>(groupWithAutoOffer)).rows[0];
    assert.ok(pick, "expected an offer group of three or more");
    await client.query("UPDATE product_sources SET method='manual' WHERE supplier_item_id=$1", [pick.item]);
    const split = (await client.query<{ id: string }>("SELECT product_split_offer($1,$2,NULL) AS id", [pick.item, pick.primary])).rows[0].id;
    assert.ok(split);
    assert.notEqual(split, pick.product);
    assert.ok((await client.query("SELECT variant FROM products WHERE id=$1", [split])).rows[0].variant > 0);
    assert.deepEqual((await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [pick.item])).rows[0],
      { product_id: split, method: "manual" });
    assert.equal((await client.query("SELECT count(*)::int AS n FROM product_offers WHERE item_id=$1", [pick.item])).rows[0].n, 0);
    assert.equal((await client.query("SELECT status FROM product_match_decisions WHERE product_a=$1 AND product_b=$2", [pick.product, split])).rows[0]?.status, "different");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("the primary offer and rows in no group are not split", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = (await client.query<{ item: string; primary: string; product: string }>(groupWithAutoOffer)).rows[0];
    assert.ok(group, "expected an offer group");
    const ungrouped = (await client.query<{ item: string }>(`SELECT s.supplier_item_id AS item FROM product_sources s
      WHERE NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=s.supplier_item_id) LIMIT 1`)).rows[0];
    const state = (item: string) => client.query("SELECT s.product_id,s.method,o.primary_id FROM product_sources s LEFT JOIN product_offers o ON o.item_id=s.supplier_item_id WHERE s.supplier_item_id=$1", [item]).then(result => result.rows[0]);
    for (const item of [group.primary, ungrouped.item]) {
      const before = await state(item);
      assert.equal((await client.query("SELECT product_split_offer($1,$2,NULL) AS id", [item, group.primary])).rows[0].id, null);
      assert.deepEqual(await state(item), before);
    }
    assert.equal((await client.query("SELECT product_split_offer(gen_random_uuid(),$1,NULL) AS id", [group.primary])).rows[0].id, null);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("master brands: every present label belongs to one, and match items use its key", async () => {
  const count = (sql: string) => one(`SELECT count(*)::int AS value FROM ${sql}`, []);
  assert.equal(await count(`(SELECT DISTINCT supplier, supplier_item_brand(supplier,product_data) AS label FROM supplier_items
    WHERE presence='present' AND product_brand_key(supplier_item_brand(supplier,product_data)) IS NOT NULL) l
    WHERE NOT EXISTS (SELECT 1 FROM supplier_brands sb WHERE sb.supplier=l.supplier AND sb.label=l.label)`), 0);
  assert.equal(await count("brands b WHERE NOT EXISTS (SELECT 1 FROM supplier_brands sb WHERE sb.brand_id=b.id)"), 0);
  assert.equal(await count(`product_match_items m JOIN supplier_items i ON i.id=m.supplier_item_id
    JOIN supplier_brands sb ON sb.supplier=i.supplier AND sb.label=supplier_item_brand(i.supplier,i.product_data)
    JOIN brands b ON b.id=sb.brand_id WHERE m.brand<>b.key`), 0);
  // Dinamik's heavy-vehicle labels (ABA-AV) share the brand of the plain label.
  assert.equal(await count(`supplier_brands av JOIN supplier_brands plain ON plain.supplier=av.supplier
    AND upper(plain.label)=regexp_replace(upper(av.label),'-AV$','') AND plain.brand_id<>av.brand_id
    WHERE av.label ~* '-AV$' AND av.method='auto' AND plain.method='auto'`), 0);
});

test("master brands: a label moved or split off changes only its own key; merging moves every label", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const key = async (supplier: string, label: string) => (await client.query("SELECT supplier_item_brand_key($1,$2) AS key",
      [supplier, JSON.stringify(supplier === "dinamik" ? { marka: label } : { uk: label })])).rows[0].key;
    assert.equal(await key("dinamik", "ABA-AV"), await key("dinamik", "ABA"));
    const own = (await client.query("SELECT brand_create('ABA-AV') AS id")).rows[0].id;
    assert.equal((await client.query("SELECT key FROM brands WHERE id=$1", [own])).rows[0].key, "ABAAV");
    await client.query("UPDATE supplier_brands SET brand_id=$1,method='manual' WHERE supplier='dinamik' AND label='ABA-AV'", [own]);
    assert.equal(await key("dinamik", "ABA-AV"), "ABAAV");
    assert.equal(await key("dinamik", "ABA"), "ABA");
    const aba = (await client.query("SELECT id FROM brands WHERE key='ABA'")).rows[0].id;
    assert.equal((await client.query("SELECT brand_merge($1,$2,NULL) AS id", [own, aba])).rows[0].id, aba);
    assert.equal(await key("dinamik", "ABA-AV"), "ABA");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM brands WHERE id=$1", [own])).rows[0].n, 0);
    // A label seen for the first time joins the brand its key already belongs to.
    await client.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      SELECT supplier,company,list_group,warehouse,'ABA TEST1','{"uk":"ABA-AV"}',0,0,0,now(),now(),now() FROM supplier_items WHERE supplier='basbug' LIMIT 1`);
    await client.query("SELECT sync_supplier_brands()");
    assert.equal(await key("basbug", "ABA-AV"), "ABA");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("new master brands get the reviewed brand they most likely are; confirmed ones get none", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Every brand reviewed, as after a full review; the test then adds new labels.
    await client.query("UPDATE supplier_brands SET method='manual'");
    const addItem = async (label: string, code: string) => (await client.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      SELECT supplier,company,list_group,warehouse,$2,jsonb_build_object('uk',$1::text),0,0,0,now(),now(),now() FROM supplier_items WHERE supplier='basbug' LIMIT 1 RETURNING id`, [label, code])).rows[0].id;
    const suggestion = async (label: string) => (await client.query<{ target: string | null }>(`SELECT t.key AS target FROM supplier_brands sb
      LEFT JOIN brand_merge_suggestions s ON s.brand_id=sb.brand_id LEFT JOIN brands t ON t.id=s.target_id WHERE sb.supplier='basbug' AND sb.label=$1`, [label])).rows[0]?.target ?? null;
    // Another spelling of a reviewed brand: its key starts with that brand's key.
    await addItem("ABA YENI SERI", "ABAYS TEST1");
    // An unrelated name that repeats a reviewed brand's own part numbers (numbers no other brand uses).
    const donor = (await client.query<{ brand: string; parts: string[] }>(`SELECT brand, (array_agg(part_number ORDER BY part_number))[1:4] AS parts
      FROM (SELECT part_number, min(brand) AS brand FROM product_match_items WHERE length(part_number)>=5 AND brand<>'ORIJINAL'
        GROUP BY part_number HAVING count(DISTINCT brand)=1) x GROUP BY brand HAVING count(*)>=4 ORDER BY brand LIMIT 1`)).rows[0];
    for (const [index, part] of donor.parts.entries()) {
      const id = await addItem("QQZX COPY", `QQZX ${part}${index}`);
      await client.query("INSERT INTO product_match_items VALUES($1,'basbug','QQZXCOPY',$2,NULL)", [id, part]);
    }
    // No evidence at all; its heavy-vehicle line arrives in the same sync (PRESTOLITE / PRESTOLITE AV, #471).
    await addItem("QQZX LONELY", "QQZXL TEST1");
    await addItem("QQZX LONELY AV", "QQZXL TEST2");
    // At least these four; labels imported since the last refresh are placed too.
    assert.ok((await client.query("SELECT sync_supplier_brands() AS n")).rows[0].n >= 4);
    await client.query("SELECT refresh_brand_merge_suggestions()");
    assert.equal(await suggestion("ABA YENI SERI"), "ABA");
    assert.equal(await suggestion("QQZX COPY"), donor.brand);
    assert.equal(await suggestion("QQZX LONELY"), null); // the shorter one is never pointed at the longer
    assert.equal(await suggestion("QQZX LONELY AV"), "QQZXLONELY");
    // "Onayla" keeps a new brand separate: it is no longer suggested.
    await client.query("UPDATE supplier_brands SET method='manual' WHERE supplier='basbug' AND label='ABA YENI SERI'");
    await client.query("SELECT refresh_brand_merge_suggestions()");
    assert.equal(await suggestion("ABA YENI SERI"), null);
    // Merging removes the suggestion with the brand.
    const copy = (await client.query("SELECT brand_id FROM supplier_brands WHERE supplier='basbug' AND label='QQZX COPY'")).rows[0].brand_id;
    await client.query("SELECT brand_merge($1,(SELECT id FROM brands WHERE key=$2),NULL)", [copy, donor.brand]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM brand_merge_suggestions WHERE brand_id=$1", [copy])).rows[0].n, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("a Dinamik product suggested to several Başbuğ products is marked shared", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [a1, a2, b, a3, b2] = (await client.query<{ id: string }>("SELECT id FROM products ORDER BY id LIMIT 5")).rows.map(row => row.id);
    await client.query(`INSERT INTO product_match_candidates(product_a,product_b,reason) VALUES ($1,$3,'suffix'),($2,$3,'suffix'),($4,$5,'suffix')`, [a1, a2, b, a3, b2]);
    const shared = (await client.query<{ product_a: string; shared: boolean }>(`SELECT product_a,${sharedCandidateSql} AS shared
      FROM product_match_candidates c WHERE product_b=ANY($1) ORDER BY product_a`, [[b, b2]])).rows;
    assert.deepEqual(shared.map(row => row.shared), [true, true, false]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("bulk accept skips unreviewed suffix and multi-number candidates, keeps leading_zero", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Distinct part numbers, and no suggestion or decision of their own that would count as "another number".
    const ids = (await client.query<{ id: string }>(`SELECT id FROM (SELECT DISTINCT ON (p.part_number) p.id FROM products p
      WHERE p.part_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_match_candidates c WHERE p.id IN (c.product_a,c.product_b))
       AND NOT EXISTS (SELECT 1 FROM product_match_decisions d WHERE p.id IN (d.product_a,d.product_b)) ORDER BY p.part_number LIMIT 10) x`)).rows.map(row => row.id);
    assert.equal(ids.length, 10);
    const [a1, a2, a3, a4, b1, b2, b3, b4, b5, b6] = ids;
    await client.query(`INSERT INTO product_match_candidates(product_a,product_b,reason) VALUES
      ($1,$5,'leading_zero'),($2,$6,'suffix'),($3,$7,'leading_zero'),($3,$8,'leading_zero'),($4,$9,'prefix')`, ids.slice(0, 9));
    await client.query("INSERT INTO product_match_decisions(product_a,product_b,status) VALUES($1,$2,'same')", [a4, b6]);
    const rows = (await client.query<{ product_a: string; product_b: string; bulk: boolean; multi: boolean }>(`SELECT c.product_a,c.product_b,
      ${bulkAcceptableSql} AS bulk,${multiNumberCandidateSql} AS multi
      FROM product_match_candidates c JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b WHERE c.product_a=ANY($1::uuid[])`, [[a1, a2, a3, a4]])).rows;
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.filter(row => row.bulk).map(row => row.product_a), [a1]);
    const multi = new Map(rows.map(row => [row.product_b, row.multi]));
    assert.deepEqual([b1, b2, b3, b4, b5].map(id => multi.get(id)), [false, false, true, true, true]);
    // Variant copies: two Dinamik products with the same part number suggested to one Başbuğ product are one code.
    const variants = (await client.query<{ a: string; b7: string; b8: string }>(`SELECT
      (SELECT p.id FROM products p WHERE p.part_number IS NOT NULL AND p.id<>ALL($1::uuid[]) AND p.id NOT IN (x.b7,x.b8)
        AND NOT EXISTS (SELECT 1 FROM product_match_candidates c WHERE p.id IN (c.product_a,c.product_b))
        AND NOT EXISTS (SELECT 1 FROM product_match_decisions d WHERE p.id IN (d.product_a,d.product_b)) LIMIT 1) AS a,
      x.b7,x.b8 FROM (SELECT min(p.id::text)::uuid AS b7,max(p.id::text)::uuid AS b8 FROM products p
        WHERE p.part_number IS NOT NULL AND p.id<>ALL($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM product_match_candidates c WHERE p.id IN (c.product_a,c.product_b))
         AND NOT EXISTS (SELECT 1 FROM product_match_decisions d WHERE p.id IN (d.product_a,d.product_b))
        GROUP BY p.part_number HAVING count(*)>=2 LIMIT 1) x`, [ids])).rows[0];
    assert.ok(variants?.a && variants.b7 && variants.b8, "expected a same-number product pair");
    await client.query("INSERT INTO product_match_candidates(product_a,product_b,reason) VALUES ($1,$2,'prefix'),($1,$3,'prefix')", [variants.a, variants.b7, variants.b8]);
    const copies = (await client.query<{ bulk: boolean; multi: boolean }>(`SELECT ${bulkAcceptableSql} AS bulk,${multiNumberCandidateSql} AS multi
      FROM product_match_candidates c JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b WHERE c.product_a=$1`, [variants.a])).rows;
    assert.deepEqual(copies, [{ bulk: true, multi: false }, { bulk: true, multi: false }]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// Suffix candidates join the bulk merge only with a reviewed safe ending (#535), through the same SQL as the action.
test("bulk accept takes reviewed safe suffix pairs and skips the rest", async () => {
  await assertSafeSuffixRules();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const product = async (brand: string, part: string, supplier: string, name = "SIS FAR CERCEVESI SAG") => (await client.query<{ id: string }>(`INSERT INTO products(brand,part_number,name,brand_label,code,suppliers)
      VALUES ($1,$2,$3,$1,$2,ARRAY[$4]) RETURNING id`, [brand, part, name, supplier])).rows[0].id;
    const pair = async (brand: string, a: string, b: string, nameB?: string) => ({ a: await product(brand, a, "basbug"), b: await product(brand, b, "dinamik", nameB) });
    const colour = await pair("ORIJINAL", "ZZ21R53501AB5YZ", "ZZ21R53501AB5YZ9");
    const maysan = await pair("MAYSAN", "PN9535001", "PN9535001MM");
    const unreviewed = await pair("ORIJINAL", "ZZ535AB5YX", "ZZ535AB5YX9");
    const conflict = await pair("ORIJINAL", "ZZ21R53501BB5YZ", "ZZ21R53501BB5YZ9", "MOTOR SUBAP TAKIMI");
    // A safe ending, but the Başbuğ product is suggested a second Dinamik number too.
    const multi = await pair("ORIJINAL", "ZZ21R53501CB5YZ", "ZZ21R53501CB5YZ9");
    const multiOther = await product("ORIJINAL", "ZZ21R53501CB5YZ1", "dinamik");
    const zero = await pair("ZZ535TEST", "0535001", "535001");
    await client.query(`INSERT INTO product_match_candidates(product_a,product_b,reason,name_conflict) VALUES
      ($1,$2,'suffix',false),($3,$4,'suffix',false),($5,$6,'suffix',false),($7,$8,'suffix',true),($9,$10,'suffix',false),($9,$11,'suffix',false),
      ($12,$13,'leading_zero',false)`, [colour.a, colour.b, maysan.a, maysan.b, unreviewed.a, unreviewed.b, conflict.a, conflict.b, multi.a, multi.b, multiOther, zero.a, zero.b]);
    const fixture = [colour, maysan, unreviewed, conflict, multi, zero].map(({ a }) => a);
    const bulk = (await client.query<{ product_a: string; product_b: string }>(`SELECT c.product_a,c.product_b FROM product_match_candidates c
      JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b WHERE c.product_a=ANY($1::uuid[]) AND ${bulkAcceptableSql}`, [fixture])).rows
      .map(row => `${row.product_a}>${row.product_b}`).sort();
    assert.deepEqual(bulk, [colour, maysan, zero].map(({ a, b }) => `${a}>${b}`).sort());
    // The action's query: one brand and reason at a time.
    const action = (await client.query<{ product_b: string }>(`SELECT c.product_b FROM product_match_candidates c
      JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b
      WHERE c.reason=$1 AND a.brand=$2 AND c.product_a=ANY($3::uuid[]) AND ${bulkAcceptableSql}`, ["suffix", "ORIJINAL", fixture])).rows;
    assert.deepEqual(action.map(row => row.product_b), [colour.b]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("merging a product that owns no rows changes nothing", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rowless = (await client.query<{ id: string; merged_into: string }>(`SELECT p.id,p.merged_into FROM products p
      WHERE p.merged_into IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=p.id) LIMIT 1`)).rows[0];
    assert.ok(rowless, "expected a merged product");
    const other = (await client.query<{ id: string }>("SELECT product_id AS id FROM product_sources WHERE product_id<>$1 LIMIT 1", [rowless.merged_into])).rows[0];
    assert.equal((await client.query("SELECT product_merge($1,$2,NULL) AS id", [rowless.id, other.id])).rows[0].id, null);
    assert.equal((await client.query("SELECT merged_into FROM products WHERE id=$1", [rowless.id])).rows[0].merged_into, rowless.merged_into);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

