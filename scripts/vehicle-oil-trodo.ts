import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { startChromeCollectors } from "../src/modules/enrichment/chrome-driver";
import { SourceBlocked, SourceQueue, WorkerStopped } from "../src/modules/enrichment/source-queue";
import { parseVehicleCsv } from "../src/modules/store/vehicle-catalog-import";
import { parseVehicleOilRow, trodoOilSheetRow, vehicleOilSheet, type VehicleOilSheetRow } from "../src/modules/store/vehicle-oil";

// Reads Trodo's recommended engine oil (TecRMI volume, SAE grades, ACEA/API classes and manufacturer approvals) for
// every vehicle type Trodo's cached vehicle listings map to a TecDoc id, into vehicle_type_trodo_oils. Requests go
// through the enrichment source queue and Chrome driver, so the www.trodo.com pacing, cache and block handling are
// the product worker's; pause that worker while this runs to give the oil run the host's whole rate.
// Vehicle types with fitments come first. Runs resume: collected types are skipped, failed requests are retried.
//
//   npm run vehicles:oil-trodo -- collect [--limit=N]
//   npm run vehicles:oil-trodo -- status
//   npm run vehicles:oil-trodo -- export        (then npm run db:vehicle-oils)

const HOST = "www.trodo.com";
const SHEET = "data/vehicle_type_oil_specs.csv";
// Requests kept waiting in the queue; the host pacing still sends them one at a time.
const PARALLEL = 3;

const args = process.argv.slice(2);
const command = args.find(arg => !arg.startsWith("--")) ?? "status";
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const oilSchema = z.array(z.object({ additional_data: z.object({ oil_data: z.object({
  rmi_car_id: z.union([z.string(), z.number()]).nullish(),
  volume: z.array(z.coerce.string()).nullish(), viscosity: z.array(z.coerce.string()).nullish(), specification: z.array(z.coerce.string()).nullish(),
}).nullable() }) })).length(1);

const oilPath = (carId: number, urlKey: string) => `/rest/V1/catalog-category-products/engine-oil/no-filter/${carId}/`
  + `${/^[a-z0-9-]+-cid$/.test(urlKey) ? urlKey : `car-${carId}-cid`}?is_ajax=true&customer_group_id=undefined`;

// Trodo cars of our vehicle types, from the cached engine listings of the product worker.
const CARS = `SELECT DISTINCT ON ((e->>'tecdoc_id')::int) (e->>'tecdoc_id')::int AS vehicle_type_id, (e->>'value')::int AS car_id, e->>'url_key' AS url_key
  FROM enrichment_source_cache c CROSS JOIN jsonb_array_elements(c.body->0->'relationships'->'data') e
  WHERE c.host='${HOST}' AND c.path LIKE '/rest/V1/vehicle/type/1/%' AND e->>'tecdoc_id' ~ '^[0-9]{1,9}$' AND e->>'value' ~ '^[0-9]{1,9}$'
  ORDER BY (e->>'tecdoc_id')::int, c.fetched_at DESC`;

async function checkDatabase() {
  const { rows } = await pool.query("SELECT current_database() AS name, current_user AS owner");
  if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
  for (const file of ["db/enrichment-worker.sql", "db/vehicle-oil-specs.sql"]) await pool.query(await readFile(file, "utf8"));
}

async function collect() {
  await checkDatabase();
  const limit = Number(option("limit") ?? Infinity);
  const { rows: targets } = await pool.query<{ vehicle_type_id: number; car_id: number; url_key: string }>(
    `WITH cars AS (${CARS}), fitted AS (SELECT vehicle_type_id, count(*) AS n FROM product_vehicle_fitments GROUP BY 1)
     SELECT cars.* FROM cars JOIN vehicle_types v ON v.id=cars.vehicle_type_id LEFT JOIN fitted f ON f.vehicle_type_id=cars.vehicle_type_id
     WHERE NOT EXISTS (SELECT 1 FROM vehicle_type_trodo_oils o WHERE o.vehicle_type_id=cars.vehicle_type_id)
     ORDER BY coalesce(f.n,0) DESC, cars.vehicle_type_id`);
  targets.splice(limit);
  if (!targets.length) { console.log("vehicle oils: nothing left to collect"); return; }

  let run = (await pool.query("SELECT id FROM enrichment_runs WHERE kind='vehicle_oil' AND status<>'complete' ORDER BY created_at LIMIT 1")).rows[0]?.id as string | undefined;
  run ??= (await pool.query("INSERT INTO enrichment_runs(kind,seed,sample_size) VALUES('vehicle_oil','trodo-engine-oil',$1) RETURNING id", [targets.length])).rows[0].id as string;
  await pool.query("UPDATE enrichment_runs SET status='running',sample_size=greatest(sample_size,$2),started_at=coalesce(started_at,now()),finished_at=NULL WHERE id=$1", [run, targets.length]);
  // A request that failed in an earlier pass is tried again instead of failing the vehicle at once.
  await pool.query("UPDATE enrichment_source_requests SET status='pending',attempts=0,available_at=now(),last_error=NULL,finished_at=NULL WHERE run_id=$1 AND status='failed'", [run]);

  const queue = new SourceQueue(pool, run);
  const collectors = startChromeCollectors(queue, { port: Number(process.env.ENRICHMENT_CHROME_PORT || 9222), profileDir: resolve(".local/enrichment/chrome-profile"),
    clientCode: await readFile("scripts/enrichment-browser-client.js", "utf8"), landing: { [HOST]: `https://${HOST}/` } });
  let stopping = false;
  const stop = () => { stopping = true; queue.stopping = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);

  const started = Date.now(), counts = { found: 0, none: 0, failed: 0 };
  let next = 0, halted: string | null = null;
  const report = () => console.log(JSON.stringify({ vehicleOils: "progress", run, done: counts.found + counts.none + counts.failed, total: targets.length, ...counts,
    perHour: Math.round((counts.found + counts.none) / ((Date.now() - started) / 3600000)) }));
  async function lane() {
    while (!stopping && next < targets.length) {
      const car = targets[next++];
      try {
        const oil = oilSchema.parse(await queue.get(HOST, oilPath(car.car_id, car.url_key)))[0].additional_data.oil_data;
        await pool.query(`INSERT INTO vehicle_type_trodo_oils(vehicle_type_id,trodo_car_id,rmi_car_id,volumes,viscosities,specifications) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT (vehicle_type_id) DO UPDATE SET trodo_car_id=EXCLUDED.trodo_car_id,rmi_car_id=EXCLUDED.rmi_car_id,volumes=EXCLUDED.volumes,
           viscosities=EXCLUDED.viscosities,specifications=EXCLUDED.specifications,fetched_at=now()`,
          [car.vehicle_type_id, car.car_id, oil?.rmi_car_id == null ? null : String(oil.rmi_car_id), oil?.volume ?? [], oil?.viscosity ?? [], oil?.specification ?? []]);
        counts[oil?.viscosity?.length ? "found" : "none"]++;
      } catch (error) {
        if (error instanceof SourceBlocked || error instanceof WorkerStopped) { halted = String(error); stop(); break; }
        counts.failed++;
        console.log(JSON.stringify({ vehicleOils: "failed", vehicleTypeId: car.vehicle_type_id, carId: car.car_id, error: String(error) }));
      }
      if ((counts.found + counts.none + counts.failed) % 100 === 0) report();
    }
  }
  try {
    await Promise.all(Array.from({ length: PARALLEL }, lane));
  } finally {
    await collectors.stop();
    const status = halted && !/stopping/i.test(halted) ? "blocked" : next >= targets.length && !stopping ? "complete" : "stopped";
    await pool.query("UPDATE enrichment_runs SET status=$2,finished_at=CASE WHEN $2='complete' THEN now() END WHERE id=$1", [run, status]);
    report();
    console.log(JSON.stringify({ vehicleOils: status, run, halted }));
  }
}

async function status() {
  const { rows: [row] } = await pool.query(`WITH cars AS (${CARS})
    SELECT (SELECT count(*) FROM vehicle_types)::int AS vehicle_types,
     (SELECT count(*) FROM cars JOIN vehicle_types v ON v.id=cars.vehicle_type_id)::int AS mapped,
     (SELECT count(*) FROM vehicle_type_trodo_oils)::int AS collected,
     (SELECT count(*) FROM vehicle_type_trodo_oils WHERE cardinality(viscosities)>0)::int AS with_oil,
     (SELECT count(*) FROM vehicle_type_trodo_oils WHERE cardinality(specifications)>0)::int AS with_specifications`);
  const runs = (await pool.query(`SELECT r.id, r.status, r.sample_size, r.cache_hits, count(q.*) FILTER (WHERE q.status='complete')::int AS requests,
     count(q.*) FILTER (WHERE q.status='failed')::int AS failed FROM enrichment_runs r LEFT JOIN enrichment_source_requests q ON q.run_id=r.id
     WHERE r.kind='vehicle_oil' GROUP BY r.id ORDER BY r.created_at`)).rows;
  const host = (await pool.query("SELECT interval_ms, jitter_ms, blocked, challenge_since, last_error FROM enrichment_source_hosts WHERE host=$1", [HOST])).rows[0];
  console.log(JSON.stringify({ ...row, runs, host }, null, 2));
}

// Trodo rows replace the sheet's rows of the same vehicle type; the others (oil_capacities) stay as they are. A Trodo
// row without a grade or a capacity takes that field from the oil_capacities row ("trodo+oil_capacities"); such a
// row keeps the borrowed values in the sheet, so exporting again borrows the same ones.
async function exportSheet() {
  const current = parseVehicleCsv(await readFile(SHEET, "utf8")).map(row => ({ ...row, source: row.source || "oil_capacities" }) as VehicleOilSheetRow);
  const merged = new Map(current.filter(row => row.source !== "trodo").map(row => [row.id, row]));
  const { rows } = await pool.query("SELECT vehicle_type_id, volumes, viscosities, specifications FROM vehicle_type_trodo_oils ORDER BY vehicle_type_id");
  let trodo = 0, borrowed = 0, empty = 0, unusable = 0;
  for (const row of rows) {
    const sheetRow = trodoOilSheetRow(row.vehicle_type_id, row);
    if (!sheetRow) { if (row.viscosities.length || row.volumes.length || row.specifications.length) unusable++; else empty++; continue; }
    const fallback = merged.get(sheetRow.id);
    if (fallback && ((!sheetRow.viscosity && fallback.viscosity) || (!sheetRow.capacity && fallback.capacity))) {
      sheetRow.viscosity ||= fallback.viscosity; sheetRow.capacity ||= fallback.capacity; sheetRow.source = "trodo+oil_capacities"; borrowed++;
    }
    try { parseVehicleOilRow(sheetRow); } catch (error) { unusable++; console.log(JSON.stringify({ vehicleOils: "unusable", vehicleTypeId: row.vehicle_type_id, error: String(error) })); continue; }
    merged.set(sheetRow.id, sheetRow); trodo++;
  }
  await writeFile(SHEET, vehicleOilSheet([...merged.values()]));
  console.log(JSON.stringify({ vehicleOils: "exported", rows: merged.size, trodo, borrowed, oilCapacities: merged.size - trodo, empty, unusable }));
}

try {
  if (command === "collect") await collect();
  else if (command === "status") await status();
  else if (command === "export") await exportSheet();
  else throw new Error(`Unknown command: ${command}`);
} finally { await pool.end(); }
