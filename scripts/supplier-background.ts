import { spawn } from "node:child_process";
import { mkdir, open, readdir, stat, unlink, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { supplierHealth } from "../src/modules/suppliers/health";

const directory = resolve(".local/supplier-logs");
await mkdir(directory, { recursive:true, mode:0o700 });
for (const name of await readdir(directory)) {
  if (!/^(sync|health)-\d+\.log$/.test(name)) continue;
  const path=resolve(directory,name);
  if ((await stat(path)).mtimeMs < Date.now()-7*86400_000) await unlink(path);
}
const monitor = process.argv.includes("--monitor");
const log = await open(resolve(directory,`${monitor ? "health" : "sync"}-${Date.now()}.log`), "a", 0o600);
const pool = new Pool({connectionString:process.env.DATABASE_URL});
try {
  if (!monitor) {
    const code = await new Promise<number>(resolveCode => {
      const child=spawn(process.execPath,["--env-file=.env.local","--import","tsx","scripts/sync-suppliers.ts"], {stdio:["ignore",log.fd,log.fd],timeout:90*60_000,killSignal:"SIGTERM"});
      child.on("error",()=>resolveCode(1));
      child.on("close",code=>resolveCode(code ?? 1));
    });
    process.exitCode=code;
  } else {
    let healthy = false;
    try {
      const health = await supplierHealth(pool);
      healthy=health.healthy;
      await log.write(JSON.stringify(health)+"\n");
    } catch { await log.write("Supplier health unavailable.\n"); }
    const statePath=resolve(directory,"notification-state.json");
    let lastAlert=0;
    try { lastAlert=JSON.parse(await readFile(statePath,"utf8")).lastAlert || 0; } catch { /* first check */ }
    if (!healthy && Date.now()-lastAlert>=3600_000) {
      await new Promise<void>(done=> {
        const notification=spawn("/usr/bin/osascript",["-e",'display notification "Otomatik fiyat/stok çekimi veya zamanlayıcı kontrol edilmeli. Yönetim ekranını açın." with title "Getirbakım veri güncelliği"'],{stdio:"ignore"});
        notification.on("error",()=>done()); notification.on("close",()=>done());
      });
      await writeFile(statePath,JSON.stringify({lastAlert:Date.now()}),{mode:0o600});
    } else if (healthy && lastAlert) await writeFile(statePath,JSON.stringify({lastAlert:0}),{mode:0o600});
    if (!healthy) process.exitCode=1;
  }
} finally { await pool.end(); await log.close(); }
