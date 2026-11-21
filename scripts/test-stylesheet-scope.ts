import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { adminSentinel, compileCss } from "./harness/measure-css.mjs";
import { chain, reach, sourceFiles } from "./test-helpers/import-graph";

// The storefront stylesheet (globals.css) scans only storefront sources; the /yonetim workspace adds admin.css, a full
// scan that is a superset of the storefront utilities (#1027). These checks keep the two in step with the import graph.
const globals = fs.readFileSync("src/app/globals.css", "utf8");
const excludedUi = (() => {
  const names = globals.match(/@source not "\.\.\/components\/ui\/\{([^}]+)\}\.tsx";/)?.[1];
  assert.ok(names, "globals.css lists the admin-only ui files in one @source not line");
  return new Set(names.split(",").map(name => `src/components/ui/${name}.tsx`));
})();

const isAdmin = (file: string) => file.startsWith("src/app/yonetim/") || file.startsWith("src/components/admin/");
const storefrontRoots = sourceFiles("src/app").filter(file => !isAdmin(file));
const storefront = reach(storefrontRoots);

test("the ui files left out of the storefront scan are not reachable from the storefront", () => {
  const found = [...excludedUi].filter(file => storefront.has(file)).map(file => chain(storefront, file));
  assert.deepEqual(found, [], "remove these from @source not in globals.css or drop the storefront import");
});

test("the storefront import graph does not reach the workspace", () => {
  const found = [...storefront.keys()].filter(isAdmin).map(file => chain(storefront, file));
  assert.deepEqual(found, []);
});

test("every ui file the storefront does not use is left out of its scan", () => {
  const missing = fs
    .readdirSync("src/components/ui")
    .filter(name => name.endsWith(".tsx"))
    .map(name => path.join("src/components/ui", name))
    .filter(file => !storefront.has(file) && !excludedUi.has(file));
  assert.deepEqual(missing, [], "add it to @source not in globals.css");
});

test("modules, lib and hooks hold no class names (globals.css does not scan them)", () => {
  const found = ["src/modules", "src/lib", "src/hooks"]
    .flatMap(dir => sourceFiles(dir))
    .filter(file => /\bclassName\b|(?<!function )\bcn\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(found, [], "move the markup to src/components or add the folder to the @source list in globals.css");
});

/** The class names used in the selectors of `css` (minified output). */
function classSelectors(css: string) {
  const classes = new Set<string>();
  for (const [, prelude] of css.matchAll(/([^{};]+)\{/g)) {
    if (prelude.trimStart().startsWith("@")) continue;
    for (const [name] of prelude.matchAll(/\.(?:\\.|[A-Za-z0-9_-])+/g)) classes.add(name);
  }
  return classes;
}

/** The body of the first `@layer <name>{…}` block. */
function layer(css: string, name: string) {
  const start = css.indexOf(`@layer ${name}{`);
  assert.ok(start >= 0, `@layer ${name}`);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index++) {
    if (css[index] === "{") depth++;
    else if (css[index] === "}" && --depth === 0) return css.slice(start, index + 1);
  }
  assert.fail(`unterminated @layer ${name}`);
}

test("compiled sheets: storefront stays scoped, the workspace sheet is a superset", async () => {
  const [store, admin] = await Promise.all([compileCss("src/app/globals.css"), compileCss("src/app/admin.css")]);

  assert.ok(!store.includes(adminSentinel), "globals.css carries sidebar utilities");
  assert.ok(!/#0f62fe/i.test(store), "globals.css carries the IBM Carbon tokens");
  assert.match(store, /\.product-card\b/);
  assert.match(store, /\.tap-44\b/);
  assert.ok(Buffer.byteLength(store) <= 270 * 1024, `globals.css is ${(Buffer.byteLength(store) / 1024).toFixed(1)} KB (budget 270 KB)`);

  assert.ok(admin.includes(adminSentinel), "admin.css carries the sidebar utilities");
  assert.match(admin, /:root:has\(\.admin-app\)\{/);
  assert.match(admin, /:root\.dark:has\(\.admin-app\)\{/);
  assert.doesNotMatch(admin, /@layer base\{/, "admin.css must not repeat preflight");

  const adminClasses = classSelectors(admin);
  const missing = [...classSelectors(layer(store, "utilities"))].filter(name => !adminClasses.has(name));
  assert.deepEqual(missing, [], "admin.css must contain every storefront utility (it stays loaded after client navigation)");
});
