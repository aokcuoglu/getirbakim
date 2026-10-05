import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await mkdir(".local", { recursive: true });
const secret = () => randomBytes(32).toString("hex");
let storage: string;
try { storage = await readFile(".local/storage.env", "utf8"); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  storage = `MINIO_ROOT_USER=getirbakim-admin\nMINIO_ROOT_PASSWORD=${secret()}\nS3_ACCESS_KEY_ID=getirbakim-media\nS3_SECRET_ACCESS_KEY=${secret()}\n`;
  await writeFile(".local/storage.env", storage, { mode: 0o600 });
}
await chmod(".local/storage.env", 0o600);
const settings = Object.fromEntries(storage.trim().split("\n").map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const s3 = { S3_ENDPOINT: "http://127.0.0.1:9002", S3_REGION: "us-east-1", S3_BUCKET: "product-media", S3_ACCESS_KEY_ID: settings.S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: settings.S3_SECRET_ACCESS_KEY };
let appEnv = await readFile(".env.local", "utf8");
for (const [key, value] of Object.entries(s3)) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  appEnv = pattern.test(appEnv) ? appEnv.replace(pattern, `${key}=${value}`) : `${appEnv.trimEnd()}\n${key}=${value}\n`;
}
await writeFile(".env.local", appEnv, { mode: 0o600 });
await chmod(".env.local", 0o600);
const compose = ["compose", "--env-file", ".local/storage.env", "-f", "deploy/storage.compose.yml"];
for (const args of [["up", "-d", "--wait", "minio"], ["run", "--rm", "--no-deps", "createbuckets"]]) {
  const result = spawnSync("docker", [...compose, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Private product-media bucket ready. S3 API: http://localhost:9002; console: http://localhost:9003. Credentials: .local/storage.env (not printed).");
