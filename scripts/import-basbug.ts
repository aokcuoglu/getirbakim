import { Pool } from "pg";
import { importBasbug, BasbugImportError } from "../src/modules/suppliers/basbug-import";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query("SELECT current_database() AS name, current_user AS owner");
  if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
  console.log(await importBasbug(pool, { group: process.env.BASBUG_SAMPLE_GROUP || "FIAT", warehouse: "MRK", acceptAnomaly: process.argv.find(arg => arg.startsWith("--accept-anomaly="))?.slice("--accept-anomaly=".length) }, stage => console.log(`Çekiliyor: ${stage}`)));
} catch (error) {
  console.error(error instanceof BasbugImportError ? error.message : "Başbuğ aktarımı başarısız. Bağlantı, servis erişimi ve şema kurulumunu kontrol edin.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
