import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const out = resolve(process.argv[2] || ".local/live-snapshot");
await mkdir(out, { recursive: true, mode: 0o700 });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const storage = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const info = (await client.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version")).rows[0];
  if (info.database !== "getirbakim" || info.role !== "getirbakim_app" || !info.version.startsWith("18.")) throw new Error("Unexpected source database");
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
  const tables = (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename")).rows;
  const counts: Record<string, string> = {};
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  for (const table of tables) counts[`${table.schemaname}.${table.tablename}`] = (await client.query(`SELECT count(*)::text AS count FROM ${quote(table.schemaname)}.${quote(table.tablename)}`)).rows[0].count;
  const mediaReferences = (await client.query("SELECT bucket,object_key,sha256,size_bytes FROM product_media_objects ORDER BY object_key")).rows;
  const connection = new URL(process.env.DATABASE_URL!);
  await new Promise<void>((ok, fail) => {
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--snapshot=${snapshot}`, `--file=${out}/database.dump`], {
      env: { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || "5432", PGDATABASE: decodeURIComponent(connection.pathname.slice(1)), PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password) }, stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", fail); child.on("close", code => code === 0 ? ok() : fail(new Error(`Database export failed (exit ${code}); credentials omitted`)));
  });
  await client.query("COMMIT");
  const media: { key: string; bytes: number; sha256: string; contentType: string }[] = [];
  const root = resolve(out, "media");
  let continuation: string | undefined;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, ContinuationToken: continuation }));
    for (const object of page.Contents || []) {
      const key = object.Key!; const target = resolve(root, key);
      if (!target.startsWith(root + sep)) throw new Error("Unsafe media key");
      const result = await storage.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      if (!result.Body) throw new Error("Missing media body");
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { mode: 0o600 });
      media.push({ key, bytes: bytes.length, sha256, contentType: result.ContentType || "application/octet-stream" });
    }
    continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuation);
  for (const ref of mediaReferences) {
    const object = media.find(item => item.key === ref.object_key);
    if (ref.bucket !== process.env.S3_BUCKET || !object || object.sha256 !== ref.sha256 || object.bytes !== Number(ref.size_bytes)) throw new Error(`Database/media mismatch: ${ref.object_key}`);
  }
  const dumpHash = createHash("sha256").update(await readFile(`${out}/database.dump`)).digest("hex");
  await writeFile(`${out}/manifest.json`, JSON.stringify({ exportedAt: new Date().toISOString(), source: info, databaseSha256: dumpHash, tables: counts, bucket: process.env.S3_BUCKET, media }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ exportedTables: Object.keys(counts).length, mediaObjects: media.length, mediaReferences: mediaReferences.length, supplierItems: counts['public.supplier_items'], directory: out }));
} finally { client.release(); await pool.end(); storage.destroy(); }
