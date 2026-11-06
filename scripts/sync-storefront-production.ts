import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";

// Carries locally collected storefront data (Trodo enrichments, categories, logos) to production:
// incremental export → split into parts → transfer → dry-run every part → import every part → rebuild fitments.
// The watermark only advances after production applied all parts, so a failed run is retried in full next time
// (the import is an idempotent upsert, so parts applied before a failure are harmless to repeat).
//
// Two targets, chosen by STOREFRONT_SYNC_TARGET in .env.local:
// - vps (default): rsync over SSH to the Contabo VPS (PRODUCTION_SSH), pg_dump backup, production-task.sh steps.
// - aws: `aws s3 sync` to the inbound bucket, then one ECS task in the operations task definition runs
//   scripts/import-storefront-inbound.ts (dry-run all, apply all, rebuild fitments). RDS point-in-time recovery
//   replaces the pg_dump backup. Needs PRODUCTION_AWS_PROFILE (a profile in ~/.aws/config, never `default`);
//   PRODUCTION_AWS_REGION and PRODUCTION_AWS_STACK_PREFIX default to eu-central-1 and GetirbakimProduction.
const target = process.env.STOREFRONT_SYNC_TARGET || "vps";
if (target !== "vps" && target !== "aws") throw new Error("STOREFRONT_SYNC_TARGET must be vps or aws");
const state = resolve(".local/storefront-sync/state.json");
// Enrichment imports that started before the last snapshot but committed after it would be missed;
// the overlap re-sends them, and the import is an idempotent upsert.
const OVERLAP_MS = 60 * 60 * 1000;
// Media bytes per part, well under the operations container's memory (see split-storefront-bundle.ts).
const PART_BYTES = 100 * 1024 * 1024;

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], env });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed with exit code ${result.status}`);
}

function vpsTarget() {
  const host = process.env.PRODUCTION_SSH;
  if (!host) throw new Error("PRODUCTION_SSH (user@host) required in .env.local");
  const remoteRoot = "/opt/getirbakim-v2-production";
  // Each step is its own ssh command with no stdin: a script piped to `bash -s` was read by the backup's
  // `docker compose exec`, which swallowed the remaining steps while the run still exited 0.
  const remote = (command: string) => run("ssh", ["-n", "-o", "BatchMode=yes", host, `cd ${remoteRoot} && ${command}`]);
  return (partsDir: string, parts: string[]) => {
    // One fixed remote directory: rsync then sends only changed files (category images repeat every run).
    const dir = `${remoteRoot}/.local/storefront-bundles/current`;
    remote(`mkdir -p ${dir}`);
    run("rsync", ["-a", "--delete", "--partial", "-e", "ssh -o BatchMode=yes", `${partsDir}/`, `${host}:${dir}/`]);
    // A failed dry run stops before anything is written.
    remote("bash scripts/production-task.sh backup");
    for (const part of parts) remote(`bash scripts/production-task.sh import-storefront ${dir}/${part}`);
    for (const part of parts) remote(`bash scripts/production-task.sh import-storefront ${dir}/${part} --apply`);
    remote("bash scripts/production-task.sh rebuild-fitments");
  };
}

function awsTarget() {
  const profile = process.env.PRODUCTION_AWS_PROFILE;
  if (!profile || profile === "default") throw new Error("PRODUCTION_AWS_PROFILE (a named profile, not default) required in .env.local");
  const region = process.env.PRODUCTION_AWS_REGION || "eu-central-1";
  const stackPrefix = process.env.PRODUCTION_AWS_STACK_PREFIX || "GetirbakimProduction";
  // AWS_* variables left over in the shell (a region, keys or a profile) must never redirect the
  // run; only the profile and Region named above count, and both are passed explicitly on every call.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AWS_"))) as NodeJS.ProcessEnv;
  const aws = (args: string[]) => {
    const result = spawnSync("aws", [...args, "--profile", profile, "--region", region, "--output", "json"], { encoding: "utf8", env });
    if (result.status !== 0) throw new Error(`aws ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  };
  const outputs = (stack: string) => Object.fromEntries(
    (aws(["cloudformation", "describe-stacks", "--stack-name", `${stackPrefix}-${stack}`])
      .Stacks[0].Outputs as { OutputKey: string; OutputValue: string }[]).map(o => [o.OutputKey, o.OutputValue]));
  return async (partsDir: string) => {
    const data = outputs("Data"), app = outputs("App"), network = outputs("Network");
    const bucket = data.InboundBucketName;
    const prefix = "storefront/current";
    // One fixed prefix: `s3 sync` then uploads only changed files (category images repeat every run).
    run("aws", ["s3", "sync", "--delete", "--only-show-errors", `${partsDir}/`, `s3://${bucket}/${prefix}/`, "--profile", profile, "--region", region], env);
    const overrides = { containerOverrides: [{ name: app.OperationsContainerName,
      command: ["node", "--conditions=react-server", "--import", "tsx", "scripts/import-storefront-inbound.ts", prefix] }] };
    const started = aws(["ecs", "run-task", "--cluster", app.ClusterName, "--task-definition", app.OperationsTaskFamily,
      "--launch-type", "FARGATE", "--count", "1", "--started-by", "storefront-sync", "--propagate-tags", "TASK_DEFINITION",
      "--network-configuration", JSON.stringify({ awsvpcConfiguration: { subnets: network.PrivateSubnetIds.split(","),
        securityGroups: [network.OperationsSecurityGroupId], assignPublicIp: "DISABLED" } }),
      "--overrides", JSON.stringify(overrides)]);
    const taskArn: string | undefined = started.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error(`run-task started no task: ${JSON.stringify(started.failures)}`);
    console.log(JSON.stringify({ task: taskArn.split("/").at(-1), bucket, prefix }));
    for (;;) {
      await new Promise(done => setTimeout(done, 15_000));
      const task = aws(["ecs", "describe-tasks", "--cluster", app.ClusterName, "--tasks", taskArn]).tasks[0];
      if (task.lastStatus !== "STOPPED") continue;
      const exitCode = task.containers?.[0]?.exitCode;
      if (exitCode !== 0) throw new Error(`Import task stopped with exit code ${exitCode ?? "none"} (${task.stoppedReason})`);
      return;
    }
  };
}

const transfer = target === "aws" ? awsTarget() : vpsTarget();
const previous = await readFile(state, "utf8").then(text => JSON.parse(text) as { snapshotAt: string }).catch(() => null);
const since = previous ? new Date(new Date(previous.snapshotAt).getTime() - OVERLAP_MS).toISOString() : null;
const name = `bundle-${new Date().toISOString().replace(/[:.]/g, "")}`;
const local = resolve(".local/storefront-sync", name);
await mkdir(local, { recursive: true });
try {
  const full = resolve(local, "full");
  run(process.execPath, ["--env-file=.env.local", "--conditions=react-server", "--import", "tsx", "scripts/export-storefront-bundle.ts", full, ...(since ? [`--since=${since}`] : [])]);
  const manifest = JSON.parse(await readFile(resolve(full, "manifest.json"), "utf8")) as { snapshotAt: string; enrichments: unknown[] };
  const parts = (await splitStorefrontBundle(full, resolve(local, "parts"), PART_BYTES)).map(dir => dir.split("/").at(-1)!);
  console.log(JSON.stringify({ target, since, snapshotAt: manifest.snapshotAt, enrichments: manifest.enrichments.length, parts: parts.length }));
  await transfer(resolve(local, "parts"), parts);
  await writeFile(state, JSON.stringify({ snapshotAt: manifest.snapshotAt, syncedAt: new Date().toISOString(), enrichments: manifest.enrichments.length }, null, 2));
  console.log(JSON.stringify({ synced: name, target, snapshotAt: manifest.snapshotAt }));
} finally {
  await rm(local, { recursive: true, force: true });
}
