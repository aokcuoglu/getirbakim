import { Pool } from "pg";
import { z } from "zod";
const argumentsByName = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match=/^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match) throw new Error("Use --name=value arguments");
  return [match[1],match[2]];
}));
const options=z.object({
  supplier:z.enum(["basbug","dinamik"]).default("basbug"),
  group:z.string().regex(/^[A-Z0-9_-]{1,30}$/),
  company:z.string().trim().min(1).max(100).default(process.env.BASBUG_FIRMA_ADI || "BASBUG"),
  warehouse:z.literal("MRK").default("MRK"),
  enabled:z.enum(["true","false"]).default("true"),
  "interval-minutes":z.coerce.number().int().min(15).max(10080).default(1440),
  "stale-minutes":z.coerce.number().int().min(15).max(20160).default(2160),
  "commerce-enabled":z.enum(["true","false"]).default("false"),
  "commerce-interval-minutes":z.coerce.number().int().min(15).max(1440).default(60),
  "commerce-stale-minutes":z.coerce.number().int().min(16).max(2880).default(120),
  "daily-at":z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default("03:00"),
}).strict().parse(argumentsByName);
if (options["commerce-stale-minutes"] <= options["commerce-interval-minutes"]) throw new Error("Commercial freshness must exceed its interval");
if (options.supplier === "dinamik" && (options.enabled === "true" || options["commerce-enabled"] === "true")) throw new Error("Dinamik adapter is not verified; enabling it is unavailable");
if (options["stale-minutes"] <= options["interval-minutes"]) throw new Error("Stale threshold must exceed the sync interval");
const pool=new Pool({ connectionString:process.env.DATABASE_URL });
try {
  const database=(await pool.query("SELECT current_database() AS name,current_user AS owner")).rows[0];
  if (database.name!=="getirbakim" || database.owner!=="getirbakim_app") throw new Error("Independent database check failed");
  // --group=ALL applies the same plan to every scope already known for this supplier/company.
  const groups=options.group==="ALL" ? (await pool.query<{list_group:string}>("SELECT list_group FROM supplier_sync_scopes WHERE supplier=$1 AND company=$2 AND warehouse=$3 ORDER BY list_group",
    [options.supplier,options.company,options.warehouse])).rows.map(row=>row.list_group) : [options.group];
  if (!groups.length) throw new Error("No known scopes for --group=ALL");
  for (const group of groups) {
  const result=await pool.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,interval_minutes,stale_minutes,daily_at,next_run_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::time,CASE WHEN $6=1440 THEN
      (((now() AT TIME ZONE 'Europe/Istanbul')::date+CASE WHEN (now() AT TIME ZONE 'Europe/Istanbul')::time>=$8::time THEN 1 ELSE 0 END)+$8::time) AT TIME ZONE 'Europe/Istanbul'
      ELSE now() END)
    ON CONFLICT(supplier,company,list_group,warehouse) DO UPDATE SET enabled=EXCLUDED.enabled,
      interval_minutes=EXCLUDED.interval_minutes,stale_minutes=EXCLUDED.stale_minutes,daily_at=EXCLUDED.daily_at,next_run_at=EXCLUDED.next_run_at
    RETURNING supplier,company,list_group,warehouse,enabled,interval_minutes,stale_minutes,daily_at,next_run_at`,
    [options.supplier,options.company,group,options.warehouse,options.enabled==="true",options["interval-minutes"],options["stale-minutes"],options["daily-at"]]);
  await pool.query(`UPDATE supplier_sync_scopes SET commerce_enabled=$5,commerce_interval_minutes=$6,
    commerce_stale_minutes=$7,commerce_next_run_at=now() WHERE supplier=$1 AND company=$2 AND list_group=$3 AND warehouse=$4`,
    [options.supplier,options.company,group,options.warehouse,options["commerce-enabled"]==="true",options["commerce-interval-minutes"],options["commerce-stale-minutes"]]);
  console.log({...result.rows[0],commerce_enabled:options["commerce-enabled"]==="true",commerce_interval_minutes:options["commerce-interval-minutes"],commerce_stale_minutes:options["commerce-stale-minutes"]});
  }
} finally { await pool.end(); }
