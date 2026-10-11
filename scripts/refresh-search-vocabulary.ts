// Rebuilds the "did you mean" word list after a large vehicle or supplier import (setup also rebuilds it).
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query("SELECT refresh_search_vocabulary()");
  await pool.query("ANALYZE search_vocabulary");
  const { rows } = await pool.query<{ scope: string; words: number }>("SELECT scope, count(*)::integer AS words FROM search_vocabulary GROUP BY scope ORDER BY scope");
  console.log(`Search vocabulary refreshed: ${rows.map(row => `${row.scope} ${row.words}`).join(", ")}`);
} finally { await pool.end(); }
