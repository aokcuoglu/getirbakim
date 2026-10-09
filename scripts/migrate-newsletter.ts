import {readFile} from "node:fs/promises";
import {Pool} from "pg";

const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
  await pool.query(await readFile("db/newsletter.sql","utf8"));
  console.log("Newsletter migration applied.");
}finally{await pool.end();}
