import { writeFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import {
  evaluateSignal, modelTokens, packTokens, signalDecision, tokenOverlap, yearRange, yearsOverlap,
  type SignalMetrics, type SignalPrediction, type SuffixPair, type SuffixStatus, type SuffixVerdict, type YearRange,
} from "../src/modules/admin/product-suffix-signals";

// Measures second signals for ambiguous part-number suffix pairs (#587). Strictly read-only: one READ ONLY transaction
// with a statement timeout, no temporary tables, no advisory locks, always rolled back. Prints Markdown.
//   npm run products:suffix-signals [-- --class review|all] [-- --json <file>]
const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const scope = option("--class") ?? "review";
if (scope !== "review" && scope !== "all") throw new Error("--class must be review or all");
const jsonFile = option("--json");
// Labels decided on or after this date come after the 2026-11-14 audit of the 2026-10-12 bulk merge.
const TRUSTED_FROM = "2026-11-14";

type Row = { supplier: string; m: string; y: string; unit: string; name: string | null; nterms: string[]; kterms: string[]; qty: number; costTry: number | null; enriched: boolean;
  types: number[]; cats: string[]; oems: string[] };
type Features = SuffixPair & {
  idA: string; idB: string; nameA: string | null; nameB: string | null; decided: boolean;
  sim: number; conflict: boolean; jaccard: number; resolved: boolean; family: string;
  ratio: number | null; packDiff: boolean; unitsDiffer: boolean | null; qtyDiff: boolean | null; coexist: boolean;
  years: boolean | null; models: boolean | null; partType: boolean | null; leakB: boolean;
  sharedTypes: boolean | null; sharedOem: boolean | null; sharedCat: boolean | null;
};
type Signal = { id: string; family: string; label: string; predicts: SignalPrediction; structural: boolean; fires: (p: Features) => boolean };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const out: string[] = [];
const say = (line = "") => out.push(line);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const familyOf = (brand: string) => brand === "ORIJINAL" ? "ORIJINAL" : brand === "DAYCO" || brand === "GATES" ? "DAYCO+GATES" : brand === "RAPRO" ? "RAPRO" : brand === "SKF" ? "SKF" : "diğer";

try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='120s'");
  const database = (await client.query("SELECT current_database() AS name")).rows[0].name as string;
  const started = Date.now();

  const labelled = (await client.query<{ a: string; b: string; status: SuffixStatus; decided_at: Date; brand: string; pa: string; pb: string; na: string | null; nb: string | null; verdict: SuffixVerdict }>(`
    SELECT d.product_a AS a, d.product_b AS b, d.status, d.decided_at, a.brand, a.part_number AS pa, b.part_number AS pb, a.name AS na, b.name AS nb,
     product_suffix_verdict(a.brand,a.part_number,b.part_number) AS verdict
    FROM product_match_decisions d JOIN products a ON a.id=d.product_a JOIN products b ON b.id=d.product_b
    WHERE a.brand=b.brand AND product_suffix_verdict(a.brand,a.part_number,b.part_number) IS NOT NULL`)).rows;
  // The suffix branch of refresh_product_matches() (db/product-matching.sql, "suffix" UNION ALL branch near line 764) without its
  // decision filter, Başbuğ-only x Dinamik-only (pairing 1) only; keep the conditions in sync with it.
  const universe = (await client.query<{ a: string; b: string; brand: string; pa: string; pb: string; na: string | null; nb: string | null; verdict: SuffixVerdict; decided: boolean }>(`
    SELECT a.id AS a, b.id AS b, a.brand, a.part_number AS pa, b.part_number AS pb, a.name AS na, b.name AS nb,
     product_suffix_verdict(a.brand,a.part_number,b.part_number) AS verdict,
     EXISTS (SELECT 1 FROM product_match_decisions d WHERE (d.product_a=a.id AND d.product_b=b.id) OR (d.product_a=b.id AND d.product_b=a.id)) AS decided
    FROM products a JOIN products b ON b.brand=a.brand AND left(b.part_number,5)=left(a.part_number,5) AND b.part_number<>a.part_number
     AND length(a.part_number)>=6 AND length(b.part_number)>=6 AND abs(length(a.part_number)-length(b.part_number))<=3
     AND (starts_with(a.part_number,b.part_number) OR starts_with(b.part_number,a.part_number))
    WHERE a.merged_into IS NULL AND a.suppliers='{basbug}' AND b.merged_into IS NULL AND b.suppliers='{dinamik}'`)).rows;

  const raw = [
    ...labelled.map(r => ({ ...r, decided: true, status: r.status as SuffixStatus | null, decidedAt: r.decided_at.toISOString().slice(0, 10) as string | null })),
    ...universe.filter(r => !r.decided).map(r => ({ ...r, status: null as SuffixStatus | null, decidedAt: null as string | null })),
  ];

  const names = await client.query<{ a: string; b: string; sim: number; conflict: boolean; jaccard: number }>(`
    SELECT k.a, k.b, similarity(lower(a.name),lower(b.name)) AS sim, COALESCE(product_names_conflict(a.name,b.name),false) AS conflict,
     CASE WHEN cardinality(t.ta)+cardinality(t.tb)=0 THEN 0
      ELSE (SELECT count(*) FROM unnest(t.ta) x WHERE x=ANY(t.tb))::float8
       / NULLIF(cardinality(t.ta)+cardinality(t.tb)-(SELECT count(*) FROM unnest(t.ta) x WHERE x=ANY(t.tb)),0) END AS jaccard
    FROM unnest($1::uuid[],$2::uuid[]) k(a,b) JOIN products a ON a.id=k.a JOIN products b ON b.id=k.b
    CROSS JOIN LATERAL (SELECT product_name_terms(a.name) AS ta, product_name_terms(b.name) AS tb) t`, [raw.map(r => r.a), raw.map(r => r.b)]);
  const nameMap = new Map(names.rows.map(r => [`${r.a}|${r.b}`, r]));

  const ids = [...new Set(raw.flatMap(r => [r.a, r.b]))];
  // Exchange rates: the latest per supplier and currency; the company is ignored (commerce_catalog keys them by company too).
  const rates = new Map((await client.query<{ supplier: string; currency: string; rate: string }>(`
    WITH latest AS (
     SELECT DISTINCT ON (supplier,company) supplier,company,currencies_data,completed_at
     FROM supplier_imports WHERE status='succeeded' ORDER BY supplier,company,completed_at DESC,id DESC
    ), rates AS (
     SELECT supplier,completed_at,r->>'dovizCinsi' AS currency,(r->>'satis')::numeric AS rate
     FROM latest CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(currencies_data->'dovizListesi')='array' THEN currencies_data->'dovizListesi' ELSE '[]'::jsonb END) r
    )
    SELECT DISTINCT ON (supplier,currency) supplier,currency,rate FROM rates ORDER BY supplier,currency,completed_at DESC`)).rows.map(r => [`${r.supplier}|${r.currency}`, Number(r.rate)]));

  const itemRows = (await client.query<{ pid: string; item_id: string; supplier: string; m: string | null; y: string | null; unit: string | null; name: string | null; nterms: string[]; kterms: string[];
    qty: string | null; dc: string | null; nf: string | null; enriched: boolean }>(`
    SELECT p.id AS pid, i.id AS item_id, i.supplier, i.product_data->>'m' AS m, i.product_data->>'y' AS y, i.product_data->>'b' AS unit,
     supplier_item_name(i.supplier,i.product_data) AS name, product_name_terms(supplier_item_name(i.supplier,i.product_data)) AS nterms,
     product_name_terms(i.product_data->>'kull8s') AS kterms,
     GREATEST(NULLIF(i.product_data->>'paketMiktari','')::numeric, NULLIF(i.product_data->>'koliMiktari','')::numeric) AS qty,
     i.product_data->>'dc' AS dc, i.price_data->>'nf' AS nf,
     EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=i.id) AS enriched
    FROM products p JOIN product_match_items m ON m.brand=p.brand AND m.part_number=p.part_number
     JOIN supplier_items i ON i.id=m.supplier_item_id
    WHERE p.id=ANY($1::uuid[])`, [ids])).rows;
  const itemIds = itemRows.map(r => r.item_id);
  const structure = new Map((await client.query<{ id: string; types: number[]; cats: string[]; oems: string[] }>(`
    SELECT k.id,
     COALESCE((SELECT array_agg(DISTINCT f.vehicle_type_id) FROM product_vehicle_fitments f WHERE f.supplier_item_id=k.id AND f.vehicle_type_id IS NOT NULL),'{}') AS types,
     COALESCE((SELECT array_agg(DISTINCT c.source||':'||c.category_id) FROM product_source_categories c WHERE c.supplier_item_id=k.id),'{}') AS cats,
     COALESCE((SELECT array_agg(DISTINCT n) FROM (
       SELECT upper(regexp_replace(r.part_number,'[^A-Za-z0-9]','','g')) AS n FROM product_references r WHERE r.supplier_item_id=k.id AND r.kind='oem'
       UNION ALL SELECT upper(regexp_replace(o,'[^A-Za-z0-9]','','g')) FROM product_enrichments e,
         LATERAL jsonb_each(CASE WHEN jsonb_typeof(e.payload->'oemNumbers')='object' THEN e.payload->'oemNumbers' ELSE '{}'::jsonb END) x,
         LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(x.value)='array' THEN x.value ELSE '[]'::jsonb END) o WHERE e.supplier_item_id=k.id) q),'{}') AS oems
    FROM unnest($1::uuid[]) k(id)`, [itemIds])).rows.map(r => [r.id, r]));

  const rowsOf = new Map<string, Row[]>();
  for (const r of itemRows) {
    const currency = r.dc ?? "";
    const rate = currency === "" || currency === "TL" || currency === "TRY" ? 1 : rates.get(`${r.supplier}|${currency}`);
    const nf = r.nf === null ? NaN : Number(r.nf);
    const s = structure.get(r.item_id);
    const list = rowsOf.get(r.pid) ?? [];
    list.push({ supplier: r.supplier, m: r.m ?? "", y: r.y ?? "", unit: r.unit ?? "", name: r.name, nterms: r.nterms, kterms: r.kterms, qty: Number(r.qty ?? 0),
      costTry: rate && nf > 0 ? nf * rate : null, enriched: r.enriched, types: s?.types ?? [], cats: s?.cats ?? [], oems: s?.oems ?? [] });
    rowsOf.set(r.pid, list);
  }

  const overlap = (a: readonly (string | number)[], b: readonly (string | number)[]) => { const set = new Set(a); return b.some(x => set.has(x)); };
  const minCost = (rows: Row[]) => { const costs = rows.map(r => r.costTry).filter((c): c is number => c !== null); return costs.length ? Math.min(...costs) : null; };
  const pairs: Features[] = raw.map(r => {
    const n = nameMap.get(`${r.a}|${r.b}`);
    const [shortNo, longNo] = r.pa.length <= r.pb.length ? [r.pa, r.pb] : [r.pb, r.pa];
    const ext = longNo.slice(shortNo.length);
    const ra = rowsOf.get(r.a) ?? [];
    const rb = rowsOf.get(r.b) ?? [];
    const all = [...ra, ...rb];
    const basbug = all.filter(x => x.supplier === "basbug");
    const dinamik = all.filter(x => x.supplier === "dinamik");
    const costA = minCost(ra);
    const costB = minCost(rb);
    const aLonger = r.pa.length > r.pb.length;
    const tokensA = packTokens(r.na ?? "", aLonger ? ext : "").join(",");
    const tokensB = packTokens(r.nb ?? "", aLonger ? "" : ext).join(",");
    const basbugYears = basbug.map(x => yearRange(x.y)).filter((x): x is YearRange => x !== null);
    const dinamikYears = dinamik.map(x => yearRange(x.name ?? "", false)).filter((x): x is YearRange => x !== null);
    const basbugModels = [...new Set(basbug.flatMap(x => modelTokens(x.m)))];
    const dinamikModels = [...new Set(dinamik.flatMap(x => modelTokens(x.name ?? "")))];
    const nterms = basbug.flatMap(x => x.nterms);
    const kterms = dinamik.flatMap(x => x.kterms);
    const unitsA = ra.filter(x => x.supplier === "basbug" && x.unit).map(x => x.unit);
    const unitsB = rb.filter(x => x.supplier === "basbug" && x.unit).map(x => x.unit);
    const qtyA = ra.filter(x => x.supplier === "dinamik");
    const qtyB = rb.filter(x => x.supplier === "dinamik");
    const typesA = ra.flatMap(x => x.types), typesB = rb.flatMap(x => x.types);
    const catsA = ra.flatMap(x => x.cats), catsB = rb.flatMap(x => x.cats);
    const oemA = ra.flatMap(x => x.oems), oemB = rb.flatMap(x => x.oems);
    return {
      status: (r.status ?? "different") as SuffixStatus, verdict: r.verdict, brand: r.brand, numbers: [shortNo, longNo], ext, decidedAt: r.decidedAt,
      idA: r.a, idB: r.b, nameA: r.na, nameB: r.nb, decided: r.status !== null,
      sim: n?.sim ?? 0, conflict: n?.conflict ?? false, jaccard: n?.jaccard ?? 0, resolved: ra.length > 0 && rb.length > 0, family: familyOf(r.brand),
      ratio: costA !== null && costB !== null ? Math.max(costA, costB) / Math.min(costA, costB) : null,
      packDiff: tokensA !== tokensB,
      unitsDiffer: unitsA.length && unitsB.length ? !overlap(unitsA, unitsB) : null,
      qtyDiff: qtyA.length && qtyB.length ? (Math.max(...qtyA.map(x => x.qty)) > 1) !== (Math.max(...qtyB.map(x => x.qty)) > 1) : null,
      coexist: overlap(ra.map(x => x.supplier), rb.map(x => x.supplier)),
      years: basbugYears.length && dinamikYears.length ? basbugYears.some(b => dinamikYears.some(d => yearsOverlap(b, d))) : null,
      models: basbugModels.length && dinamikModels.length ? tokenOverlap(basbugModels, dinamikModels) > 0 : null,
      partType: nterms.length && kterms.length ? overlap(nterms, kterms) : null,
      leakB: rb.some(x => x.enriched),
      sharedTypes: typesA.length && typesB.length ? overlap(typesA, typesB) : null,
      sharedOem: oemA.length && oemB.length ? overlap(oemA, oemB) : null,
      sharedCat: catsA.length && catsB.length ? overlap(catsA, catsB) : null,
    };
  });

  const labelledPairs = pairs.filter(p => p.decided);
  const evaluated = labelledPairs.filter(p => p.verdict === "review" || scope === "all");
  const trusted = (p: Features) => p.status === "different" || (p.decidedAt ?? "") >= TRUSTED_FROM;
  const undecidedReview = pairs.filter(p => !p.decided && p.verdict === "review");
  const count = (list: Features[], status: SuffixStatus) => list.filter(p => p.status === status).length;

  // Signal catalogue.
  const signals: Signal[] = [];
  const add = (id: string, family: string, label: string, predicts: SignalPrediction, fires: (p: Features) => boolean, structural = false) => signals.push({ id, family, label, predicts, structural, fires });
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    add(`S1 sim>=${t}`, "S1", `ad benzerliği >= ${t}`, "same", p => p.sim >= t);
    add(`S1 sim<${t}`, "S1", `ad benzerliği < ${t}`, "different", p => p.sim < t);
  }
  add("S2 conflict", "S2", "ad terimleri çelişiyor", "different", p => p.conflict);
  add("S2 jaccard>=0.5", "S2", "ad terimi Jaccard >= 0,5", "same", p => p.jaccard >= 0.5);
  add("S3 type shared", "S3", "kategori vekili (kull8s ∩ ad) ortak", "same", p => p.partType === true);
  add("S3 type disjoint", "S3", "kategori vekili ortak değil", "different", p => p.partType === false);
  add("S4 models shared", "S4", "araç model sözcüğü ortak", "same", p => p.models === true);
  add("S4 models disjoint", "S4", "araç model sözcüğü ortak değil", "different", p => p.models === false);
  add("S5 years overlap", "S5", "yıl aralıkları örtüşüyor", "same", p => p.years === true);
  add("S5 years disjoint", "S5", "yıl aralıkları örtüşmüyor", "different", p => p.years === false);
  for (const t of [1.15, 1.3, 1.5]) add(`S6 ratio<=${t}`, "S6", `fiyat oranı <= ${t}`, "same", p => p.ratio !== null && p.ratio <= t);
  for (const t of [1.5, 2]) add(`S6 ratio>${t}`, "S6", `fiyat oranı > ${t}`, "different", p => p.ratio !== null && p.ratio > t);
  add("S7 pack words", "S7", "paket sözcüğü yalnız bir tarafta", "different", p => p.packDiff);
  add("S7 package qty", "S7", "Dinamik paket/koli miktarı tek tarafta >1", "different", p => p.qtyDiff === true);
  add("S7 unit", "S7", "Başbuğ birimi (b) farklı", "different", p => p.unitsDiffer === true);
  add("S8 coexist", "S8", "aynı tedarikçide iki numara ayrı satır", "different", p => p.coexist);
  add("S9 vehicle types", "S9", "ortak araç tipi (yapısal)", "same", p => p.sharedTypes === true, true);
  add("S9 oem", "S9", "ortak OEM (yapısal)", "same", p => p.sharedOem === true, true);
  add("S9 category", "S9", "ortak kaynak kategorisi (yapısal)", "same", p => p.sharedCat === true, true);

  const measure = (signal: Signal) => {
    const all = evaluateSignal(evaluated, signal.fires, signal.predicts);
    const reliable = evaluateSignal(evaluated.filter(trusted), signal.fires, signal.predicts);
    const contradictions = signal.predicts === "different"
      ? labelledPairs.filter(p => p.verdict === "same" && signal.fires(p)).length
      : labelledPairs.filter(p => p.verdict === "different" && p.status === "different" && signal.fires(p)).length;
    const touches = undecidedReview.filter(signal.fires).length;
    const decision = signal.structural ? "reject" : signalDecision(signal.predicts, all, { contradictions, trustedWrong: reliable.wrong });
    return { signal, all, reliable, contradictions, touches, decision };
  };
  const results = signals.map(measure);

  const combos: Signal[] = [];
  for (const predicts of ["same", "different"] as const) {
    const best = new Map<string, (typeof results)[number]>();
    for (const r of results.filter(x => x.signal.predicts === predicts && !x.signal.structural && x.all.fires > 0)) {
      const current = best.get(r.signal.family);
      if (!current || r.all.wilson > current.all.wilson || (r.all.wilson === current.all.wilson && r.all.correct > current.all.correct)) best.set(r.signal.family, r);
    }
    const top = [...best.values()].sort((x, y) => y.all.wilson - x.all.wilson).slice(0, 3);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const a = top[i].signal, b = top[j].signal;
      combos.push({ id: `S10 ${a.id} & ${b.id}`, family: "S10", label: `${a.label} VE ${b.label}`, predicts, structural: false, fires: p => a.fires(p) && b.fires(p) });
    }
  }
  const comboResults = (['same', 'different'] as const).flatMap(predicts => combos.filter(c => c.predicts === predicts).map(measure).sort((x, y) => y.all.wilson - x.all.wilson).slice(0, 3));

  const header = `| Sinyal | Tahmin | Ateşler | Doğru | Yanlış | İsabet | Wilson alt | Kapsam | Güvenilir (doğru/yanlış) | Dış doğrulama çelişki | Evrende dokunduğu | Karar |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`;
  const line = (r: ReturnType<typeof measure>) => `| ${r.signal.id} (${r.signal.label}) | ${r.signal.predicts === "same" ? "aynı" : "farklı"} | ${r.all.fires} | ${r.all.correct} | ${r.all.wrong} | ${pct(r.all.precision)} | ${r.all.wilson.toFixed(2)} | ${pct(r.all.coverage)} | ${r.reliable.correct}/${r.reliable.wrong} | ${r.contradictions} | ${r.touches} | ${r.decision} |`;

  say(`## #587 son ek ikinci sinyal ölçümü (${database}, ${new Date().toISOString().slice(0, 10)})`);
  say();
  say(`Ölçüm kümesi: \`${scope}\` sınıfı. Salt okunur işlem, ${((Date.now() - started) / 1000).toFixed(1)} sn.`);
  say();
  say("### Etiketli son ek çiftleri");
  say("| Kural kararı | Çift | Aynı | Farklı |\n| --- | ---: | ---: | ---: |");
  for (const v of ["different", "same", "review"] as const) {
    const list = labelledPairs.filter(p => p.verdict === v);
    say(`| ${v} | ${list.length} | ${count(list, "same")} | ${count(list, "different")} |`);
  }
  say();
  say(`Ölçüm kümesi ${evaluated.length} çift (${count(evaluated, "same")} aynı / ${count(evaluated, "different")} farklı); güvenilir alt küme ${evaluated.filter(trusted).length} çift (${count(evaluated.filter(trusted), "same")} aynı / ${count(evaluated.filter(trusted), "different")} farklı).`);
  const unresolved = evaluated.filter(p => !p.resolved).length;
  say(`Tedarikçi satırı çözülemeyen çift: ${unresolved}.`);
  say();
  say("`review` marka dağılımı:");
  say("| Marka ailesi | Çift | Aynı | Farklı |\n| --- | ---: | ---: | ---: |");
  const families = [...new Set(evaluated.map(p => p.family))].sort();
  for (const f of families) { const list = evaluated.filter(p => p.family === f); say(`| ${f} | ${list.length} | ${count(list, "same")} | ${count(list, "different")} |`); }
  say();
  say(`Evren (bugünkü ürünlerde Başbuğ × Dinamik son ek çiftleri): ${universe.length} (karara bağlanmış ${universe.filter(u => u.decided).length}, bekleyen ${universe.filter(u => !u.decided).length}; bekleyen \`review\` ${undecidedReview.length}).`);
  say();
  say("### Sinyaller");
  say(header);
  for (const r of results) say(line(r));
  say();
  say("### Birleşimler (her yönde, farklı ailelerden en iyi üç tekilin ikili AND'leri; yönde en çok 3)");
  say(header);
  for (const r of comboResults) say(line(r));
  say();

  say("### Marka ailesi bazında en iyi sinyal");
  say("| Aile | Çift (aynı/farklı) | En iyi \"farklı\" sinyali | En iyi \"aynı\" sinyali | Sonuç |\n| --- | ---: | --- | --- | --- |");
  for (const f of families) {
    const list = evaluated.filter(p => p.family === f);
    const best = (predicts: SignalPrediction) => {
      let top: { id: string; m: SignalMetrics; contradictions: number } | null = null;
      for (const s of signals.filter(x => x.predicts === predicts && !x.structural)) {
        const m = evaluateSignal(list, s.fires, predicts);
        if (m.fires && (!top || m.wilson > top.m.wilson || (m.wilson === top.m.wilson && m.correct > top.m.correct))) top = { id: s.id, m, contradictions: results.find(r => r.signal === s)?.contradictions ?? 0 };
      }
      return top;
    };
    const d = best("different"), s = best("same");
    const show = (x: typeof d) => x ? `${x.id}: ${x.m.correct}/${x.m.fires}, Wilson ${x.m.wilson.toFixed(2)}` : "-";
    let verdict = "yetersiz örnek";
    if (list.length >= 20) {
      const okDifferent = d && signalDecision("different", d.m, { contradictions: d.contradictions, trustedWrong: 0 }) !== "reject";
      const okSame = s && signalDecision("same", s.m, { contradictions: s.contradictions, trustedWrong: 0 }) !== "reject";
      verdict = okDifferent || okSame ? "eşik geçti" : "reject";
    }
    say(`| ${f} | ${list.length} (${count(list, "same")}/${count(list, "different")}) | ${show(d)} | ${show(s)} | ${verdict} |`);
  }
  say();

  say("### Yapısal sinyal kapsamı ve etiket sızıntısı (ölçüm kümesi)");
  const covered = (pick: (p: Features) => boolean | null) => evaluated.filter(p => pick(p) !== null).length;
  say("| Sinyal | İki tarafta da veri olan çift |\n| --- | ---: |");
  say(`| Araç tipi uyumu | ${covered(p => p.sharedTypes)} / ${evaluated.length} |`);
  say(`| Kaynak kategorisi | ${covered(p => p.sharedCat)} / ${evaluated.length} |`);
  say(`| OEM referansı (iki tarafta da) | ${covered(p => p.sharedOem)} / ${evaluated.length} |`);
  say(`| Yıl (Başbuğ y × Dinamik adı) | ${covered(p => p.years)} / ${evaluated.length} |`);
  say(`| Araç metni (Başbuğ m × Dinamik adı) | ${covered(p => p.models)} / ${evaluated.length} |`);
  say(`| Fiyat oranı | ${evaluated.filter(p => p.ratio !== null).length} / ${evaluated.length} |`);
  say();
  say("| Etiket | b tarafı zenginleştirilmiş |\n| --- | ---: |");
  for (const status of ["same", "different"] as const) { const list = evaluated.filter(p => p.status === status); say(`| ${status === "same" ? "aynı" : "farklı"} | ${list.filter(p => p.leakB).length}/${list.length} |`); }
  say("Birleştirme sonrası zenginleştirme ana üründe toplandığı için uyum/kategori/OEM sinyali karar anındaki durumu göstermez; bu sinyaller karar kuralına girmez.");
  say();

  const suspects = labelledPairs.filter(p => p.status === "same" && (p.conflict || (p.ratio !== null && p.ratio > 2) || p.coexist));
  say(`### Şüpheli "aynı" kararlar (${suspects.length}; yalnız rapor, veri değişmez)`);
  say("| Marka | Numaralar | Ek | Kural | Neden | Ad A | Ad B |\n| --- | --- | --- | --- | --- | --- | --- |");
  for (const p of suspects) {
    const why = [p.conflict ? "ad çelişkisi" : "", p.ratio !== null && p.ratio > 2 ? `fiyat ${p.ratio.toFixed(1)}x` : "", p.coexist ? "aynı tedarikçide ayrı satır" : ""].filter(Boolean).join(", ");
    say(`| ${p.brand} | ${p.numbers[0]} / ${p.numbers[1]} | ${p.ext} | ${p.verdict} | ${why} | ${p.nameA ?? ""} | ${p.nameB ?? ""} |`);
  }

  if (jsonFile) await writeFile(jsonFile, JSON.stringify(pairs.map(p => ({ ...p, fired: Object.fromEntries(signals.filter(s => s.fires(p)).map(s => [s.id, true])) })), null, 1));
  await client.query("ROLLBACK");
  console.log(out.join("\n"));
} catch (error) {
  await rollback(client);
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function rollback(connection: PoolClient) {
  try { await connection.query("ROLLBACK"); } catch { /* the transaction already ended */ }
}
