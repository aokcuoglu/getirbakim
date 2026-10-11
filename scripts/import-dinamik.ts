import { Pool } from "pg";
import { DinamikImportError, discoverDinamikBrands, importDinamik } from "../src/modules/suppliers/dinamik-import";

// One brand: --brand="FEBI" [--accept-anomaly="reason"]. Brand list only: --discover.
// Every enabled brand on its schedule: npm run supplier:sync (or --force --supplier=dinamik).
const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query("SELECT current_database() AS name, current_user AS owner");
  if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
  if (process.argv.includes("--discover")) console.log(await discoverDinamikBrands(pool));
  else {
    const brand = option("brand");
    if (!brand) throw new Error("--brand or --discover required");
    console.log(await importDinamik(pool, { brand, acceptAnomaly: option("accept-anomaly") }));
  }
} catch (error) {
  console.error(error instanceof DinamikImportError ? error.message : error instanceof Error && error.message.startsWith("--") ? error.message
    : "Dinamik aktarımı başarısız. Bağlantı, IP izni (VPS) ve şema kurulumunu kontrol edin.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
