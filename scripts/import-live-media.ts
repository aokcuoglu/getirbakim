import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { objectStorage } from "../src/lib/object-storage";
if (process.env.APP_ENV !== "production") throw new Error("Production environment required");
const root = resolve(process.argv[2] || "/snapshot");
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
const storage = objectStorage();
try {
  for (const object of manifest.media) {
    const path = resolve(root, "media", object.key);
    if (!path.startsWith(resolve(root, "media") + sep)) throw new Error("Unsafe media key");
    const bytes = await readFile(path);
    if (bytes.length !== object.bytes || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error("Snapshot media integrity failed");
    await storage.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.key, Body: bytes, ContentType: object.contentType }));
    const saved = await storage.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.key }));
    const savedBytes = await saved.Body?.transformToByteArray();
    if (!savedBytes || createHash("sha256").update(savedBytes).digest("hex") !== object.sha256) throw new Error("Restored media integrity failed");
  }
  console.log(`PASS restored and verified ${manifest.media.length} private media objects`);
} finally { storage.destroy(); }
