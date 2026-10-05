import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {z} from "zod";
import {importManufacturerLogo} from "../src/modules/store/manufacturer-logo-import";

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const entriesSchema=z.array(z.object({supplierItemId:z.uuid(),imageFile:z.string().min(1),imageSource:z.url()}));
try {
  if(process.argv[2]==="prepare") {
    await pool.query(await readFile("db/manufacturer-logos.sql","utf8"));
    console.log("Manufacturer logo registry ready");
  } else if(process.argv[2]==="import") {
    const entries=entriesSchema.parse(JSON.parse(await readFile(process.argv[3],"utf8")));
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      for(const entry of entries) console.log(JSON.stringify(await importManufacturerLogo(client,entry.supplierItemId,entry)));
      await client.query("COMMIT");
    } catch(error) {await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  } else throw Error("Expected prepare or import path/to/logos.json");
} finally {await pool.end();}
