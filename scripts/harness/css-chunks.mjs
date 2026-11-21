// Usage: node scripts/harness/css-chunks.mjs [.next]
// Post-build stylesheet gate (#1027): reads every `_client-reference-manifest.js` of the last `next build` and checks the
// CSS each segment links (`entryCSSFiles`). A segment outside /yonetim must never link the workspace chunk (the one whose
// CSS carries the sidebar sentinel `collapsible=icon`); a /yonetim segment links the storefront chunk before it, so
// admin.css wins on equal specificity. Exit code 1 on a violation, 2 when there is no build to read.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/** Selector that only the /yonetim sidebar emits; a storefront chunk must not contain it. */
export const adminSentinel = "collapsible=icon";

/** The `__RSC_MANIFEST` entries a manifest file defines, as { route: manifest }. */
export function readManifest(code) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.__RSC_MANIFEST ?? {};
}

const isWorkspace = (segment) => /\/src\/app\/yonetim(\/|$)/.test(segment);

/**
 * Violations for `manifests` ({ route: { entryCSSFiles: { segment: [{ path }] } } }) given the set of workspace
 * chunk paths. Each entry is a readable sentence.
 */
export function checkCssChunks(manifests, adminChunks) {
  const problems = [];
  let workspaceSegments = 0;
  for (const [route, manifest] of Object.entries(manifests)) {
    for (const [segment, files] of Object.entries(manifest.entryCSSFiles ?? {})) {
      const paths = files.map((file) => file.path);
      const admin = paths.findIndex((file) => adminChunks.has(file));
      if (!isWorkspace(segment)) {
        if (admin !== -1) problems.push(`${route}: ${segment} links the workspace chunk ${paths[admin]}`);
        continue;
      }
      workspaceSegments++;
      if (admin === -1) problems.push(`${route}: ${segment} does not link the workspace chunk`);
      else if (!paths.slice(0, admin).some((file) => !adminChunks.has(file))) problems.push(`${route}: ${segment} links the workspace chunk before the storefront sheet (${paths.join(", ")})`);
    }
  }
  if (!workspaceSegments) problems.push("no /yonetim segment found in the manifests");
  return problems;
}

function manifestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...manifestFiles(full));
    else if (entry.name.endsWith("_client-reference-manifest.js")) found.push(full);
  }
  return found;
}

function main() {
  const root = process.argv[2] ?? ".next";
  const chunkDir = path.join(root, "static/chunks");
  const appDir = path.join(root, "server/app");
  if (!existsSync(chunkDir) || !existsSync(appDir)) {
    console.error(`css-chunks: no build in ${root} (run npm run build first)`);
    process.exit(2);
  }
  const adminChunks = new Set(
    readdirSync(chunkDir)
      .filter((name) => name.endsWith(".css") && readFileSync(path.join(chunkDir, name), "utf8").includes(adminSentinel))
      .map((name) => `static/chunks/${name}`),
  );
  if (!adminChunks.size) {
    console.error(`css-chunks: no CSS chunk carries ${adminSentinel}; admin.css is missing from the build`);
    process.exit(1);
  }
  const files = manifestFiles(appDir);
  const manifests = Object.assign({}, ...files.map((file) => readManifest(readFileSync(file, "utf8"))));
  const problems = checkCssChunks(manifests, adminChunks);
  for (const problem of problems) console.error(`css-chunks: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(`css-chunks: ${Object.keys(manifests).length} routes, workspace chunk ${[...adminChunks].join(", ")} only on /yonetim, after the storefront sheet`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
