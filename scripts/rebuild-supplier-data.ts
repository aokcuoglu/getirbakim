import { mkdir, chmod, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import { BasbugImportError, importBasbug, importOptions } from "../src/modules/suppliers/basbug-import";

// Explicit reset, staged full import, then atomic replacement. Existing data survives any fetch failure.
if (process.argv.slice(2).join(" ") !== "--reset") throw new Error("Explicit --reset is required");
const namespace = `supplier_rebuild_${randomBytes(8).toString("hex")}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const control = await pool.connect();
let staging: Pool | undefined;
let schedulerLocked = false;
let supplierLocked = false;
let transaction = false;
let created = false;
const report: { group: string; products: number; missingPrices: number; missingStocks: number; conflicting: number }[] = [];
function required(key: string) {
  const value=process.env[key];
  if (!value) throw new Error(`Missing configuration: ${key}`);
  return value;
}
async function command(name: string, args: string[], env = process.env) {
  await new Promise<void>((resolve,reject) => {
    const child=spawn(name,args,{ env,stdio:"ignore" });
    child.once("error",()=>reject(new Error(`${name} could not start`)));
    child.once("exit",code=>code===0 ? resolve() : reject(new Error(`${name} failed (exit ${code})`)));
  });
}
try {
  const database=(await control.query("SELECT current_database() AS name,current_user AS owner")).rows[0];
  if (database.name!=="getirbakim" || database.owner!=="getirbakim_app") throw new Error("Independent database check failed");
  schedulerLocked=(await control.query("SELECT pg_try_advisory_lock(20261001,2) AS locked")).rows[0].locked;
  if (!schedulerLocked) throw new Error("Scheduler is running; rebuild was not started");
  // Discover the live group list before creating or clearing anything.
  const base=new URL(required("BASBUG_BASE_URL"));
  if(base.protocol!=="https:" || base.hostname!=="api.basbug.com.tr" || base.username || base.password) throw new Error("Invalid Başbuğ endpoint");
  const login=await fetch(new URL("/auth/Login",base),{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(20_000),headers:{"Content-Type":"application/json"},
    body:JSON.stringify({kullaniciAdi:required("BASBUG_USERNAME"),parola:required("BASBUG_PASSWORD"),clientID:required("BASBUG_CLIENT_ID"),clientSecret:required("BASBUG_CLIENT_SECRET")}),
  });
  if(!login.ok) throw new Error(`Authentication failed: HTTP ${login.status}`);
  const auth=z.object({ token:z.string().min(1),tokenTipi:z.literal("Bearer") }).parse(await login.json());
  const company=process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const url=new URL("/material/ListeGrubuGetir",base);
  url.search=new URLSearchParams({FirmaAdi:company}).toString();
  const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(60_000),headers:{Authorization:`Bearer ${auth.token}`}});
  if(!response.ok) throw new Error(`Group discovery failed: HTTP ${response.status}`);
  const groups=z.object({malzemeGruplariListesi:z.array(z.object({kod:z.string().min(1),ad:z.string()})).min(1)}).parse(await response.json()).malzemeGruplariListesi;
  if(new Set(groups.map(group=>group.kod)).size!==groups.length) throw new Error("Duplicate upstream group codes");
  for(const group of groups) importOptions.parse({ group:group.kod,company,warehouse:"MRK" });
  console.log({ discoveredGroups:groups });
  await control.query(`CREATE SCHEMA ${namespace}`); created=true;
  staging=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${namespace}`,max:2});
  await staging.query(await readFile("db/schema.sql","utf8"));
  await staging.query("INSERT INTO supplier_sync_migrations(name) VALUES('current-items-v1')");
  for(const [index,group] of groups.entries()) {
    console.log(`Liste ${index+1}/${groups.length}: ${group.kod} (${group.ad})`);
    let result: Awaited<ReturnType<typeof importBasbug>> | undefined;
    for(let attempt=1;attempt<=3;attempt++) {
      try { result=await importBasbug(staging,{group:group.kod,company,warehouse:"MRK"},stage=>console.log(`${group.kod}: ${stage}`)); break; }
      catch(error) {
        if(!(error instanceof BasbugImportError) || error.reason!=="upstream" || attempt===3) throw error;
        console.log(`${group.kod}: geçici servis hatası; yeniden deneme ${attempt+1}/3`);
        await new Promise(resolve=>setTimeout(resolve,15_000));
      }
    }
    if(!result) throw new Error(`Import did not finish: ${group.kod}`);
    report.push({group:group.kod,products:result.uniqueProducts,missingPrices:result.missingPrices,missingStocks:result.missingStocks,conflicting:result.conflictingCodes});
    console.log(report[report.length-1]);
    // Modest pacing between groups; no concurrent upstream requests.
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  // A new run is a clean successful baseline, so discard staging-only transient retry records.
  await staging.query("DELETE FROM supplier_imports WHERE status<>'succeeded'");
  const staged=(await staging.query(`SELECT (SELECT count(*) FROM supplier_items) AS products,
    (SELECT count(*) FROM supplier_imports WHERE status='succeeded') AS groups,
    (SELECT count(*) FROM supplier_import_items) AS legacy,
    (SELECT count(*) FROM supplier_items WHERE presence<>'present') AS absent`)).rows[0];
  if(Number(staged.groups)!==groups.length || Number(staged.products)!==report.reduce((sum,row)=>sum+row.products,0) || Number(staged.legacy)!==0 || Number(staged.absent)!==0) throw new Error("Staged data verification failed");
  supplierLocked=(await control.query("SELECT pg_try_advisory_lock(20261001,1) AS locked")).rows[0].locked;
  if(!supplierLocked) throw new Error("Manual import is running; existing data preserved");
  await mkdir(".local/supplier-backups",{recursive:true,mode:0o700});
  const backup=`.local/supplier-backups/pre-rebuild-${Date.now()}.dump`;
  // libpq's PGDATABASE environment variable needs a database name, not a connection URI.
  const databaseUrl=new URL(required("DATABASE_URL"));
  const dumpEnvironment={...process.env,
    PGHOST:databaseUrl.hostname,PGPORT:databaseUrl.port || "5432",
    PGUSER:decodeURIComponent(databaseUrl.username),PGPASSWORD:decodeURIComponent(databaseUrl.password),
    PGDATABASE:decodeURIComponent(databaseUrl.pathname.slice(1)),
    ...(databaseUrl.searchParams.has("sslmode") ? {PGSSLMODE:databaseUrl.searchParams.get("sslmode")!} : {}),
  };
  await command("pg_dump",["--format=custom",`--exclude-schema=${namespace}`,`--file=${backup}`],dumpEnvironment);
  await chmod(backup,0o600);
  await command("pg_restore",["--list",backup]);
  if((await stat(backup)).size<100) throw new Error("Backup file is empty");
  console.log({ verifiedBackup:backup });
  await control.query("BEGIN"); transaction=true;
  // All unrelated application tables remain intact. No CASCADE into future unknown references.
  await control.query("TRUNCATE supplier_item_changes,supplier_import_items,supplier_items,supplier_imports,supplier_sync_scopes RESTART IDENTITY");
  // Physical column order can differ after incremental ALTER TABLE migrations.
  for(const table of ["supplier_imports","supplier_items","supplier_item_changes","supplier_sync_scopes"]) {
    const columns=(await control.query<{column_name:string}>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position", [table],
    )).rows.map(row=>`"${row.column_name.replaceAll('"','""')}"`).join(",");
    if(!columns) throw new Error(`Missing target table: ${table}`);
    await control.query(`INSERT INTO ${table} (${columns}) ${table==="supplier_item_changes" ? "OVERRIDING SYSTEM VALUE" : ""} SELECT ${columns} FROM ${namespace}.${table}`);
  }
  await control.query("SELECT setval(pg_get_serial_sequence('supplier_item_changes','id'),COALESCE((SELECT max(id) FROM supplier_item_changes),1),EXISTS(SELECT 1 FROM supplier_item_changes))");
  await control.query("INSERT INTO supplier_sync_migrations(name) VALUES('current-items-v1') ON CONFLICT DO NOTHING");
  const checked=(await control.query(`SELECT (SELECT count(*) FROM supplier_imports) AS groups,(SELECT count(*) FROM supplier_items) AS products,
    (SELECT count(*) FROM supplier_item_changes) AS events,(SELECT count(*) FROM supplier_import_items) AS legacy,
    (SELECT count(*) FROM supplier_sync_scopes WHERE enabled) AS enabled_groups`)).rows[0];
  if(Number(checked.groups)!==groups.length || Number(checked.enabled_groups)!==groups.length || Number(checked.products)!==Number(staged.products) || Number(checked.events)!==Number(staged.products) || Number(checked.legacy)!==0) throw new Error("Final data verification failed");
  await control.query("COMMIT"); transaction=false;
  const result={ completedAt:new Date().toISOString(),backup,counts:checked,groups:report };
  const reportPath=`.local/supplier-backups/rebuild-report-${Date.now()}.json`;
  await writeFile(reportPath,JSON.stringify(result,null,2),{mode:0o600});
  console.log({ ...result,reportPath });
} catch(error) {
  if(transaction) await control.query("ROLLBACK");
  console.error(error instanceof BasbugImportError ? error.message : error instanceof z.ZodError ? "Upstream response failed contract validation" : error instanceof Error ? error.message : "Rebuild failed");
  process.exitCode=1;
} finally {
  try {
    if(staging) await staging.end();
    if(created) await control.query(`DROP SCHEMA ${namespace} CASCADE`);
  } finally {
    if(supplierLocked) await control.query("SELECT pg_advisory_unlock(20261001,1)");
    if(schedulerLocked) await control.query("SELECT pg_advisory_unlock(20261001,2)");
    control.release(); await pool.end();
  }
}
