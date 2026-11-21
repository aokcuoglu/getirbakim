import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import {
  acquireLock, checkInboundReport, type InboundReport, LOCK_PATH, nextRetry, parseRetryItems, parseSyncArgs, releaseLock, sinceFrom, STATE_PATH, summarizeParts, SYNC_DIR,
  reportKey, type SyncState, tombstoneWarnings,
} from "./storefront-sync-state";
import { TOMBSTONE_RETENTION_DAYS } from "./storefront-bundle-tombstones";
import { type RemoteObject, uploadParts } from "./storefront-upload";

// Carries locally collected storefront data (Trodo enrichments, categories, logos) to production:
// incremental export → split into parts → transfer → dry-run every part → import every part → rebuild fitments.
// The watermark only advances after production applied all parts, so a failed run is retried in full next time
// (the import is an idempotent upsert, so parts applied before a failure are harmless to repeat).
//
// The only target is AWS: every part is `aws s3 sync`ed to the inbound bucket one by one and listed back against its own
// manifest (present, same size, no leftovers; storefront-upload.ts, #1129), stale parts are removed, and only then one ECS task in the operations task definition runs
// scripts/import-storefront-inbound.ts (dry-run all, apply all, rebuild fitments). RDS point-in-time recovery
// is the backup. A failed upload check stops the run before the import and the watermark stays. A real run holds a
// caffeinate assertion on macOS so the Mac does not sleep mid-transfer. Needs PRODUCTION_AWS_PROFILE (a profile in ~/.aws/config, never `default`);
// PRODUCTION_AWS_REGION and PRODUCTION_AWS_STACK_PREFIX default to eu-central-1 and GetirbakimProduction.
// The VPS target was removed (#563); STOREFRONT_SYNC_TARGET is no longer read, only rejected when it is not `aws`.
//
// The watermark lives in .local/storefront-sync/state.aws.json (storefront-sync-state.ts STATE_PATH).
// Flags:
//   --dry-run          export and split only, print the part summary; no transfer, no state, no lock.
//   --baseline=<ISO>   without --dry-run: record <ISO> as the target's last snapshot and exit (--force overwrites an
//                      existing state). With --dry-run: use <ISO> as this run's watermark, nothing is written.
//   --full             send every enrichment, ignoring the watermark (the aws target refuses to start without a state
//                      otherwise, so a full send is always deliberate).
//   --max-deletions=<n> the most enrichments the import may delete for local deletions (#564, default 1000); more
//                      stop the import before anything is written.
// Any other argument is an error. Real runs and --baseline hold .local/storefront-sync/sync.lock, so two syncs
// (launchd and a manual run) never overlap.
// aws: the import task writes report.json (media bucket, storefront-sync-state.ts reportKey); without a report
// matching this bundle the watermark does not move. Enrichments it skipped (supplier item not on AWS yet) are kept in
// state.aws.json as `retry` and exported again next run whatever the watermark (export --retry-file).
// Every bundle carries the tombstones of enrichments deleted or invalidated locally in the last 90 days
// (storefront-bundle-tombstones.ts); an operations image older than #564 ignores them, which is only a warning.
// An old `vps` value must not silently run something else.
if (process.env.STOREFRONT_SYNC_TARGET && process.env.STOREFRONT_SYNC_TARGET !== "aws") {
  throw new Error("STOREFRONT_SYNC_TARGET is obsolete: the VPS target was removed (#563), AWS is the only target. Remove it or set it to aws.");
}
const target = "aws";
const { dryRun, full, force, baseline, maxDeletions } = parseSyncArgs(process.argv.slice(2), new Date());
const state = resolve(STATE_PATH);
// Enrichment imports that started before the last snapshot but committed after it would be missed;
// the overlap re-sends them, and the import is an idempotent upsert.
const OVERLAP_MS = 60 * 60 * 1000;
// Media bytes per part, well under the operations container's memory (see split-storefront-bundle.ts).
const PART_BYTES = 100 * 1024 * 1024;

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], env });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed with exit code ${result.status}`);
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
  return async (partsDir: string, parts: string[]) => {
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
    // One fixed prefix: `s3 sync` per part uploads only changed files (category images repeat every run). Each part is
    // listed back and checked against its manifest before the import task may start.
    const list = (extra: string[], query: string) => aws(["s3api", "list-objects-v2", "--bucket", bucket, ...extra, "--query", query]);
    await uploadParts({
      partsDir, parts, log: console.log,
      io: {
        syncPart: part => run("aws", ["s3", "sync", "--delete", "--only-show-errors", `${partsDir}/${part}/`, `s3://${bucket}/${prefix}/${part}/`, "--profile", profile, "--region", region], env),
        listPart: part => ((list(["--prefix", `${prefix}/${part}/`], "Contents[].[Key,Size]") ?? []) as [string, number][])
          .map(([key, size]): RemoteObject => ({ key: key.slice(`${prefix}/${part}/`.length), size })),
        listRoot: () => {
          const listing = list(["--prefix", `${prefix}/`, "--delimiter", "/"], "{keys: Contents[].Key, prefixes: CommonPrefixes[].Prefix}") as { keys: string[] | null; prefixes: string[] | null } | null;
          return { keys: (listing?.keys ?? []).map(key => key.slice(prefix.length + 1)), prefixes: (listing?.prefixes ?? []).map(entry => entry.slice(prefix.length + 1)) };
        },
        removePrefix: path => run("aws", ["s3", "rm", "--recursive", "--only-show-errors", `s3://${bucket}/${prefix}/${path}`, "--profile", profile, "--region", region], env),
      },
    });
    const overrides = { containerOverrides: [{ name: app.OperationsContainerName,
      command: ["node", "--conditions=react-server", "--import", "tsx", "scripts/import-storefront-inbound.ts", prefix] }] };
    const started = aws(["ecs", "run-task", "--cluster", app.ClusterName, "--task-definition", app.OperationsTaskFamily,
      "--launch-type", "FARGATE", "--count", "1", "--started-by", "storefront-sync", "--propagate-tags", "TASK_DEFINITION",
      "--network-configuration", JSON.stringify({ awsvpcConfiguration: { subnets: network.PrivateSubnetIds.split(","),
        securityGroups: [network.OperationsSecurityGroupId], assignPublicIp: "DISABLED" } }),
      "--overrides", JSON.stringify(overrides)]);
    const taskArn: string | undefined = started.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error(`run-task started no task: ${JSON.stringify(started.failures)}`);
    console.log(JSON.stringify({ task: taskArn.split("/").at(-1), bucket, prefix, at: new Date().toISOString() }));
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
else throw new Error(`${state} is missing: record the last synced snapshot with --baseline=<ISO>, or send everything deliberately with --full`);

const name = `bundle-${new Date().toISOString().replace(/[:.]/g, "")}`;
const local = resolve(SYNC_DIR, name);
const writesState = !dryRun;
// Constructed only for real runs: it validates its credentials (the AWS profile) up front.
const transfer = dryRun || baseline ? null : awsTarget();
if (writesState) {
  await mkdir(SYNC_DIR, { recursive: true });
  acquireLock(LOCK_PATH, { pid: process.pid, target });
  // A sleeping Mac stalls the upload for hours (#1129): hold an idle-sleep assertion for this process's lifetime.
  if (!baseline && process.platform === "darwin") spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" }).unref();
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
    const startedAt = Date.now();
    run(process.execPath, ["--env-file=.env.local", "--conditions=react-server", "--import", "tsx", "scripts/export-storefront-bundle.ts", fullDir,
      ...(since ? [`--since=${since}`] : []), ...(retry.length ? [`--retry-file=${retryFile}`] : []), ...(maxDeletions ? [`--max-deletions=${maxDeletions}`] : []),
      // Pruning the local log is a write: only real runs do it.
      ...(dryRun ? [] : ["--prune"])]);
    const manifest = JSON.parse(await readFile(resolve(fullDir, "manifest.json"), "utf8")) as {
      snapshotAt: string; enrichments: unknown[]; jobs?: unknown[]; tombstones?: unknown[]; invalidatedJobs?: number; maxDeletions?: number;
    };
    const tombstones = manifest.tombstones?.length ?? 0;
    const exportMs = Date.now() - startedAt;
    const splitStart = Date.now();
    const partsDir = resolve(local, "parts");
    const parts = (await splitStorefrontBundle(fullDir, partsDir, PART_BYTES)).map(dir => dir.split("/").at(-1)!);
    const splitMs = Date.now() - splitStart;
    if (!transfer) {
      const summary = await summarizeParts(partsDir);
      console.log(JSON.stringify({
        dryRun: true, target, since, snapshotAt: manifest.snapshotAt, retried: retry.length, tombstones, invalidatedJobs: manifest.invalidatedJobs ?? 0, maxDeletions: manifest.maxDeletions,
        totals: { ...summary.totals, mediaMB: Math.round(summary.totals.mediaBytes / 1024 / 1024 * 10) / 10 }, base: summary.base, parts: summary.parts,
      }, null, 2));
    } else {
      console.log(JSON.stringify({
        target, since, snapshotAt: manifest.snapshotAt, enrichments: manifest.enrichments.length, jobs: manifest.jobs?.length ?? 0, tombstones,
        invalidatedJobs: manifest.invalidatedJobs ?? 0, maxDeletions: manifest.maxDeletions, retried: retry.length, parts: parts.length, exportMs, splitMs,
      }));
      const result = await transfer(partsDir, parts);
      // Throws (the watermark stays) when the report is missing or belongs to another bundle.
      const report = checkInboundReport(result, manifest.snapshotAt);
      const outcome = nextRetry(report);
      for (const warning of outcome.warnings) console.warn(`WARNING: ${warning}`);
      const next = outcome.retry;
      const deletions = tombstoneWarnings(report, tombstones, TOMBSTONE_RETENTION_DAYS);
      for (const warning of deletions.warnings) console.warn(`WARNING: ${warning}`);
      for (const note of deletions.notes) console.log(note);
      const written: SyncState = {
        snapshotAt: manifest.snapshotAt, syncedAt: new Date().toISOString(), target, since, enrichments: manifest.enrichments.length, jobs: manifest.jobs?.length ?? 0, tombstones,
        ...(next.length ? { retry: next } : {}),
      };
      await writeFile(state, JSON.stringify(written, null, 2));
      console.log(JSON.stringify({ synced: name, target, snapshotAt: manifest.snapshotAt, retry: next.length }));
    }
  }
} finally {
  await rm(local, { recursive: true, force: true });
  if (writesState) releaseLock(LOCK_PATH);
}
