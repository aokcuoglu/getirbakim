import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Carries locally collected storefront data (Trodo enrichments, categories, logos) to production:
// incremental export → rsync → backup → dry-run import → import → rebuild fitments. The watermark only
// advances after production applied the bundle, so a failed run is retried in full next time.
const host = process.env.PRODUCTION_SSH;
if (!host) throw new Error("PRODUCTION_SSH (user@host) required in .env.local");
const remoteRoot = "/opt/getirbakim-v2-production";
const state = resolve(".local/storefront-sync/state.json");
// Enrichment imports that started before the last snapshot but committed after it would be missed;
// the overlap re-sends them, and the import is an idempotent upsert.
const OVERLAP_MS = 60 * 60 * 1000;

function run(command: string, args: string[], input?: string) {
  const result = spawnSync(command, args, { stdio: ["pipe", "inherit", "inherit"], input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed with exit code ${result.status}`);
}
const remote = (script: string) => run("ssh", ["-o", "BatchMode=yes", host, "bash", "-s"], `set -euo pipefail\ncd ${remoteRoot}\n${script}\n`);

const previous = await readFile(state, "utf8").then(text => JSON.parse(text) as { snapshotAt: string }).catch(() => null);
const since = previous ? new Date(new Date(previous.snapshotAt).getTime() - OVERLAP_MS).toISOString() : null;
const name = `bundle-${new Date().toISOString().replace(/[:.]/g, "")}`;
const local = resolve(".local/storefront-sync", name);
await mkdir(local, { recursive: true });
try {
  run(process.execPath, ["--env-file=.env.local", "--conditions=react-server", "--import", "tsx", "scripts/export-storefront-bundle.ts", local, ...(since ? [`--since=${since}`] : [])]);
  const manifest = JSON.parse(await readFile(resolve(local, "manifest.json"), "utf8")) as { snapshotAt: string; enrichments: unknown[] };
  console.log(JSON.stringify({ since, snapshotAt: manifest.snapshotAt, enrichments: manifest.enrichments.length }));
  // One fixed remote directory: rsync then sends only changed files (category images repeat every run).
  const target = `${remoteRoot}/.local/storefront-bundles/current`;
  remote(`mkdir -p ${target}`);
  run("rsync", ["-a", "--delete", "--partial", "-e", "ssh -o BatchMode=yes", `${local}/`, `${host}:${target}/`]);
  // A failed dry run stops before anything is written; the bundle stays for inspection.
  remote(`bash scripts/production-task.sh backup
bash scripts/production-task.sh import-storefront ${target}
bash scripts/production-task.sh import-storefront ${target} --apply
bash scripts/production-task.sh rebuild-fitments`);
  await writeFile(state, JSON.stringify({ snapshotAt: manifest.snapshotAt, syncedAt: new Date().toISOString(), enrichments: manifest.enrichments.length }, null, 2));
  console.log(JSON.stringify({ synced: name, snapshotAt: manifest.snapshotAt }));
} finally {
  await rm(local, { recursive: true, force: true });
}
