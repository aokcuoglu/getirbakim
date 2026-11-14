import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import {
  acquireLock, checkInboundReport, type InboundReport, LOCK_PATH, nextRetry, parseRetryItems, parseSyncArgs, releaseLock, sinceFrom, statePath, summarizeParts, SYNC_DIR,
  reportKey, type SyncState,
} from "./storefront-sync-state";

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
//
// Each target has its own watermark (storefront-sync-state.ts: state.json for vps, state.aws.json for aws).
// Flags:
//   --dry-run          export and split only, print the part summary; no transfer, no state, no lock.
//   --baseline=<ISO>   without --dry-run: record <ISO> as the target's last snapshot and exit (--force overwrites an
//                      existing state). With --dry-run: use <ISO> as this run's watermark, nothing is written.
//   --full             send every enrichment, ignoring the watermark (the aws target refuses to start without a state
//                      otherwise, so a full send is always deliberate).
// Any other argument is an error. Real runs and --baseline hold .local/storefront-sync/sync.lock, so two syncs
// (launchd and a manual run) never overlap.
// aws: the import task writes report.json (media bucket, storefront-sync-state.ts reportKey); without a report
// matching this bundle the watermark does not move. Enrichments it skipped (supplier item not on AWS yet) are kept in
// state.aws.json as `retry` and exported again next run whatever the watermark (export --retry-file).
const target = process.env.STOREFRONT_SYNC_TARGET || "vps";
if (target !== "vps" && target !== "aws") throw new Error("STOREFRONT_SYNC_TARGET must be vps or aws");
const { dryRun, full, force, baseline } = parseSyncArgs(process.argv.slice(2), new Date());
const state = resolve(statePath(target));
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
    // The VPS flow writes no import report.
    return null;
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
    const result = spawnSync("aws", [...args, "--profile", profile, "--region", region, "--output", "json"], { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`aws ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  };
  const outputs = (stack: string) => Object.fromEntries(
    (aws(["cloudformation", "describe-stacks", "--stack-name", `${stackPrefix}-${stack}`])
      .Stacks[0].Outputs as { OutputKey: string; OutputValue: string }[]).map(o => [o.OutputKey, o.OutputValue]));
  return async (partsDir: string) => {
    const data = outputs("Data"), app = outputs("App"), network = outputs("Network");
    // A previous import task still running (e.g. this machine slept through its wait) would read the prefix this
    // upload replaces. A failing check stops the run too: an unknown state is not "nothing running".
    const running = aws(["ecs", "list-tasks", "--cluster", app.ClusterName, "--started-by", "storefront-sync", "--desired-status", "RUNNING"]);
    if (!Array.isArray(running?.taskArns)) throw new Error("aws ecs list-tasks returned no task list");
    if (running.taskArns.length) throw new Error(`A storefront import task is still running: ${running.taskArns.join(", ")}`);
    const bucket = data.InboundBucketName;
    const prefix = "storefront/current";
    // The import task writes report.json to its media bucket (S3_BUCKET): a Data stack output if there is one,
    // otherwise the operations task definition's own S3_BUCKET, the value the task runs with.
    const mediaBucket: string | undefined = data.MediaBucketName ?? (aws(["ecs", "describe-task-definition", "--task-definition", app.OperationsTaskFamily])
      .taskDefinition.containerDefinitions as { name: string; environment?: { name: string; value: string }[] }[])
      .find(container => container.name === app.OperationsContainerName)?.environment?.find(variable => variable.name === "S3_BUCKET")?.value;
    if (!mediaBucket) throw new Error("The media bucket (S3_BUCKET of the operations task) could not be determined");
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
      // An operations image older than #553 writes no report (checkInboundReport then stops the run).
      try {
        return aws(["s3", "cp", `s3://${mediaBucket}/${reportKey(prefix)}`, "-"]) as InboundReport;
      } catch (error) {
        if (/\b404\b|Not Found|NoSuchKey/i.test((error as Error).message)) return null;
        throw error;
      }
    }
  };
}

const previous = await readFile(state, "utf8").then(text => JSON.parse(text) as SyncState).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
});

let since: string | null;
if (full) since = null;
else if (baseline) since = sinceFrom({ snapshotAt: baseline }, OVERLAP_MS);
else if (previous) since = sinceFrom(previous, OVERLAP_MS);
else if (target === "aws") throw new Error(`${state} is missing: record the last synced snapshot with --baseline=<ISO>, or send everything deliberately with --full`);
else since = null;

const name = `bundle-${new Date().toISOString().replace(/[:.]/g, "")}`;
const local = resolve(SYNC_DIR, name);
const writesState = !dryRun;
// Constructed only for real runs: both validate their credentials (profile, SSH host) up front.
const transfer = dryRun || baseline ? null : target === "aws" ? awsTarget() : vpsTarget();
if (writesState) {
  await mkdir(SYNC_DIR, { recursive: true });
  acquireLock(LOCK_PATH, { pid: process.pid, target });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      releaseLock(LOCK_PATH);
      rmSync(local, { recursive: true, force: true });
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}
try {
  if (baseline && !dryRun) {
    if (previous && !force) throw new Error(`${state} exists (snapshotAt ${previous.snapshotAt}); add --force to overwrite it`);
    // A forced baseline keeps the retry list: those enrichments are still missing on the target.
    const written: SyncState = { snapshotAt: baseline, baseline: true, syncedAt: new Date().toISOString(), target, ...(previous?.retry ? { retry: previous.retry } : {}) };
    await writeFile(state, JSON.stringify(written, null, 2));
    console.log(JSON.stringify({ baseline: written, state }));
  } else {
    await mkdir(local, { recursive: true });
    const retry = previous?.retry ?? [];
    const retryFile = resolve(local, "retry.json");
    if (retry.length) await writeFile(retryFile, JSON.stringify(parseRetryItems(JSON.stringify(retry))));
    const fullDir = resolve(local, "full");
    run(process.execPath, ["--env-file=.env.local", "--conditions=react-server", "--import", "tsx", "scripts/export-storefront-bundle.ts", fullDir,
      ...(since ? [`--since=${since}`] : []), ...(retry.length ? [`--retry-file=${retryFile}`] : [])]);
    const manifest = JSON.parse(await readFile(resolve(fullDir, "manifest.json"), "utf8")) as { snapshotAt: string; enrichments: unknown[]; jobs?: unknown[] };
    const partsDir = resolve(local, "parts");
    const parts = (await splitStorefrontBundle(fullDir, partsDir, PART_BYTES)).map(dir => dir.split("/").at(-1)!);
    if (!transfer) {
      const summary = await summarizeParts(partsDir);
      console.log(JSON.stringify({
        dryRun: true, target, since, snapshotAt: manifest.snapshotAt, retried: retry.length,
        totals: { ...summary.totals, mediaMB: Math.round(summary.totals.mediaBytes / 1024 / 1024 * 10) / 10 }, base: summary.base, parts: summary.parts,
      }, null, 2));
    } else {
      console.log(JSON.stringify({ target, since, snapshotAt: manifest.snapshotAt, enrichments: manifest.enrichments.length, jobs: manifest.jobs?.length ?? 0, retried: retry.length, parts: parts.length }));
      const result = await transfer(partsDir, parts);
      let next = previous?.retry;
      if (target === "aws") {
        // Throws (the watermark stays) when the report is missing or belongs to another bundle.
        const outcome = nextRetry(checkInboundReport(result, manifest.snapshotAt));
        for (const warning of outcome.warnings) console.warn(`WARNING: ${warning}`);
        next = outcome.retry;
      }
      const written: SyncState = {
        snapshotAt: manifest.snapshotAt, syncedAt: new Date().toISOString(), target, since, enrichments: manifest.enrichments.length, jobs: manifest.jobs?.length ?? 0,
        ...(next?.length ? { retry: next } : {}),
      };
      await writeFile(state, JSON.stringify(written, null, 2));
      console.log(JSON.stringify({ synced: name, target, snapshotAt: manifest.snapshotAt, retry: next?.length ?? 0 }));
    }
  }
} finally {
  await rm(local, { recursive: true, force: true });
  if (writesState) releaseLock(LOCK_PATH);
}
