import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";

if (process.env.APP_ENV !== "staging") throw new Error("Staging verification requires APP_ENV=staging");
const base = process.env.VERIFY_URL || "http://app:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let session = "";
try {
  const database = (await pool.query("SELECT current_database() AS name, current_user AS role")).rows[0];
  assert.deepEqual(database, { name: "getirbakim", role: "getirbakim_app" });
  const vehicles = (await pool.query("SELECT count(*)::int AS count FROM vehicle_types")).rows[0].count;
  assert.ok(vehicles > 37000, "Vehicle catalog must be loaded");

  const login = await fetch(`${base}/giris`);
  assert.equal(login.status, 200);
  const html = await login.text();
  const form = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)]
    .map(match => match[1]).find(value => value.includes('name="password"'));
  assert.ok(form, "Login action form missing");
  const body = new FormData();
  for (const input of form.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]+)"/)?.[1];
    if (name) body.set(name, input[0].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  assert.ok([...body.keys()].some(key => key.startsWith("$ACTION_ID_")));
  body.set("email", process.env.ADMIN_EMAIL!);
  body.set("password", process.env.ADMIN_PASSWORD!);
  const result = await fetch(`${base}/giris`, { method: "POST", body, headers: { origin: base }, redirect: "manual" });
  assert.equal(result.status, 303, "Staging administrator login failed");
  session = result.headers.getSetCookie().find(cookie => cookie.startsWith("gb_session="))?.split(";")[0] ?? "";
  assert.ok(session, "Administrator session cookie missing");
  const admin = await fetch(`${base}/yonetim`, { headers: { cookie: session }, redirect: "manual" });
  assert.equal(admin.status, 200, "Authenticated administrator cannot open management");
  console.log("PASS independent database, vehicle catalog, administrator login and session");

  const storage = objectStorage();
  const key = ".staging-probes/media.txt";
  const content = "getirbakim isolated staging media verification";
  await storage.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: content, ContentType: "text/plain" }));
  const stored = await storage.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  assert.equal(await stored.Body?.transformToString(), content);
  storage.destroy();
  console.log("PASS private media upload and download");
} finally {
  if (session) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [createHash("sha256").update(session.slice("gb_session=".length)).digest("hex")]);
  await pool.end();
}
