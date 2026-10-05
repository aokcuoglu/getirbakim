import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createHash } from "node:crypto";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
 const assets=JSON.parse(await readFile("docs/design-reference/assets.json","utf8")) as {key:string;name:string;kind:string;sourceUrl:string;localPath:string;contentType:string;sha256:string;bytes:number}[];
 let count=0;
 for(const a of assets.filter(a=>a.kind!=="stylesheet")) {
  const file=await readFile(`public${a.localPath}`);
  if(createHash("sha256").update(file).digest("hex")!==a.sha256) throw new Error(`Asset checksum mismatch: ${a.name}`);
  await pool.query("INSERT INTO media_assets(id,name,kind,source_url,local_path,content_type,sha256,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET local_path=EXCLUDED.local_path,sha256=EXCLUDED.sha256,size_bytes=EXCLUDED.size_bytes",[a.key,a.name,a.kind,a.sourceUrl,a.localPath,a.contentType,a.sha256,a.bytes]);
  count++;
 }
 console.log(`${count} local image/font assets verified and registered. Binary files remain in public/media/trodo.`);
} finally { await pool.end(); }
