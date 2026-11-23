import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { adminSentinel, compileCss } from "./harness/measure-css.mjs";
import { allImports, chain, reach, resolve, sourceFiles } from "./test-helpers/import-graph";

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

// Everything under src that globals.css does not scan, so a new top-level src/<dir> is covered too.
const unscanned = fs
  .readdirSync("src", { withFileTypes: true })
  .filter(entry => !(entry.isDirectory() && ["app", "components", "content"].includes(entry.name)))
  .flatMap(entry => {
    const full = path.join("src", entry.name);
    return entry.isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });

test("files outside app, components and content hold no class names (globals.css does not scan them)", () => {
  assert.ok(unscanned.some(file => file.startsWith("src/lib/")), "src/lib is checked");
  const found = unscanned.filter(file => /\bclassName\b|(?<!function )\bcn\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(found, [], "move the markup to src/components or add the folder to the @source list in globals.css");
});

test("the import graph reads single- and double-quoted specifiers", () => {
  const fixture = [
    "import { a } from 'single';",
    'import b from "double";',
    "export { c } from './re-export';",
    "import type { D } from 'types-only';",
    "import './side-effect.css';",
    "const lazy = () => import('./lazy');",
  ].join("\n");
  assert.deepEqual(allImports(fixture).sort(), ["./lazy", "./re-export", "./side-effect.css", "double", "single"]);
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
  assert.ok(Buffer.byteLength(store) <= 248 * 1024, `globals.css is ${(Buffer.byteLength(store) / 1024).toFixed(1)} KB (budget 248 KB)`);
  assert.doesNotMatch(store, /\.dark\b/, "add the new dark: class to @source not inline in globals.css (the storefront never sets .dark)");

  assert.ok(admin.includes(adminSentinel), "admin.css carries the sidebar utilities");
  assert.match(admin, /:root:has\(\.admin-app\)\{/);
  assert.match(admin, /:root\.dark:has\(\.admin-app\)\{/);
  assert.doesNotMatch(admin, /@layer base\{/, "admin.css must not repeat preflight");

  const adminClasses = classSelectors(admin);
  const missing = [...classSelectors(layer(store, "utilities"))].filter(name => !adminClasses.has(name));
  assert.deepEqual(missing, [], "admin.css must contain every storefront utility (it stays loaded after client navigation)");
});

test("every dark: class left out of the storefront sheet is still emitted for the workspace", async () => {
  const list = globals.match(/@source not inline\("([^"]+)"\);/)?.[1];
  assert.ok(list, "globals.css lists the workspace-only dark: classes in one @source not inline line");
  const admin = classSelectors(await compileCss("src/app/admin.css"));
  const names = list.split(" ").filter(Boolean);
  assert.ok(names.every(name => name.startsWith("dark:")), "only dark: classes belong in that list");
  const missing = names.filter(name => !admin.has(`.${name.replace(/[^A-Za-z0-9_-]/g, "\\$&")}`));
  assert.deepEqual(missing, [], "admin.css must still emit these (remove stale entries from @source not inline)");
});

// Second and third `@source not inline` lists (#1288): utilities only unused ui exports use, and stray words Tailwind
// reads from comments and identifiers. The first list (dark:) is covered above.
const inlineLists = [...globals.matchAll(/@source not inline\("([^"]+)"\);/g)].map(match => match[1].split(" ").filter(Boolean));
assert.equal(inlineLists.length, 3, "globals.css has three @source not inline lists: dark:, unused ui exports, stray words");
const [, uiExportList, strayWords] = inlineLists;
const selectorOf = (name: string) => `.${name.replace(/[^A-Za-z0-9_-]/g, "\\$&")}`;
const boundary = (name: string) =>
  new RegExp(`(?<![A-Za-z0-9_\\-:/\\[\\].!])${name.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")}(?![A-Za-z0-9_\\-:/\\[\\]])`);

const cssSources = ["src/app/storefront.css", "src/app/catalog-card.css", "src/app/theme.css"];
const nonAdminSources = [...sourceFiles("src/app"), ...sourceFiles("src/components"), ...sourceFiles("src/content")].filter(file => !isAdmin(file));
const scannedUi = fs
  .readdirSync("src/components/ui")
  .filter(name => name.endsWith(".tsx"))
  .map(name => path.join("src/components/ui", name))
  .filter(file => !excludedUi.has(file));
const storefrontOnly = nonAdminSources.filter(file => !file.startsWith("src/components/ui/"));
const read = (file: string) => fs.readFileSync(file, "utf8");

test("every utility left out as an unused ui export or stray word is still emitted for the workspace", async () => {
  const admin = classSelectors(await compileCss("src/app/admin.css"));
  const missing = [...uiExportList, ...strayWords].filter(name => !admin.has(selectorOf(name)));
  assert.deepEqual(missing, [], "admin.css must still emit these (remove stale entries from @source not inline)");
});

test("no storefront source uses a class left out as an unused ui export", () => {
  const found: string[] = [];
  for (const file of [...storefrontOnly, ...cssSources]) {
    const text = read(file);
    for (const name of uiExportList) if (boundary(name).test(text)) found.push(`${name} in ${file}`);
  }
  assert.deepEqual(found, [], "remove the class from the second @source not inline list in globals.css");
});

/** Top-level `function`/`const` declarations of a ui file, each with the text up to the next declaration. */
function declarations(text: string) {
  const starts = [...text.matchAll(/^(?:export\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/gm)];
  return starts.map((match, index) => ({ name: match[1], text: text.slice(match.index, starts[index + 1]?.index ?? text.length) }));
}

/** Named value imports of a ui file (`import { A, B as C } from "<specifier>"`). */
function namedImports(text: string) {
  const found: { specifier: string; names: string[] }[] = [];
  for (const [, names, specifier] of text.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm)) {
    found.push({ specifier, names: names.split(",").map(part => part.trim().replace(/^type\s+.*/, "").split(/\s+as\s+/)[0]).filter(Boolean) });
  }
  return found;
}

test("excluded ui classes sit only in exports the storefront does not import", () => {
  const chunks = new Map<string, { file: string; name: string; text: string }>();
  for (const file of scannedUi) for (const chunk of declarations(read(file))) chunks.set(`${file}#${chunk.name}`, { file, ...chunk });

  const used = new Map<string, string>();
  const queue: string[] = [];
  const mark = (key: string, by: string) => {
    if (chunks.has(key) && !used.has(key)) {
      used.set(key, by);
      queue.push(key);
    }
  };

  const wholeModule: string[] = [];
  for (const file of sourceFiles("src").filter(file => !isAdmin(file) && !file.startsWith("src/components/ui/"))) {
    const text = read(file);
    if (/import\s*\*\s*as\s+\w+\s+from\s*["']@\/components\/ui\//.test(text) || /import\(\s*["']@\/components\/ui\//.test(text)) wholeModule.push(file);
    for (const { specifier, names } of namedImports(text)) {
      const target = specifier.startsWith("@/components/ui/") ? resolve(file, specifier) : undefined;
      if (target) for (const name of names) mark(`${target}#${name}`, file);
    }
  }
  assert.deepEqual(wholeModule, [], "import ui exports by name so unused ones can be left out of the storefront sheet");

  while (queue.length) {
    const key = queue.shift() as string;
    const chunk = chunks.get(key) as { file: string; name: string; text: string };
    const importer = used.get(key) as string;
    for (const other of chunks.values()) {
      if (other.file === chunk.file && other.name !== chunk.name && new RegExp(`\\b${other.name}\\b`).test(chunk.text)) mark(`${other.file}#${other.name}`, importer);
    }
    for (const { specifier, names } of namedImports(read(chunk.file))) {
      const target = specifier.startsWith("@/components/ui/") ? resolve(chunk.file, specifier) : undefined;
      if (target) for (const name of names) if (new RegExp(`\\b${name}\\b`).test(chunk.text)) mark(`${target}#${name}`, importer);
    }
  }

  const problems: string[] = [];
  for (const name of uiExportList) {
    const holders = [...chunks.entries()].filter(([, chunk]) => boundary(name).test(chunk.text));
    const preamble = scannedUi.filter(file => {
      const text = read(file);
      const first = declarations(text)[0];
      return boundary(name).test(first ? text.slice(0, text.indexOf(first.text)) : text);
    });
    if (!holders.length && !preamble.length) problems.push(`${name}: in no scanned ui export (stale entry)`);
    for (const [key, chunk] of holders) if (used.has(key)) problems.push(`${name}: in ${chunk.file} ${chunk.name}, imported by ${used.get(key)}`);
    for (const file of preamble) problems.push(`${name}: outside any export of ${file}`);
  }
  assert.deepEqual(problems, [], "remove these from the second @source not inline list in globals.css");
});

/** `text` without block and line comments (a `//` after `:` or a quote is kept: URLs). */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("stray words are not used as classes", () => {
  const found: string[] = [];
  for (const file of [...storefrontOnly, ...scannedUi]) {
    const text = stripComments(read(file));
    for (const [, , literal] of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const tokens = literal.split(/\s+/).filter(Boolean);
      for (const word of strayWords) if (tokens.length > 1 && tokens.includes(word)) found.push(`${word} in a class list in ${file}`);
    }
    for (const word of strayWords) {
      if (new RegExp(`\\b(?:className|class)=\\{?\\s*["'\`]${word}["'\`]`).test(text)) found.push(`${word} as className in ${file}`);
    }
  }
  for (const file of cssSources) {
    for (const [, classes] of read(file).matchAll(/@apply\s+([^;}]+)/g)) {
      for (const word of strayWords) if (classes.split(/\s+/).includes(word)) found.push(`${word} in @apply in ${file}`);
    }
  }
  assert.deepEqual(found, [], "remove the word from the third @source not inline list in globals.css");
});

test("the exclusions remove exactly the listed utilities", async () => {
  const real = await compileCss("src/app/globals.css");
  const from = path.resolve("src/app/globals.css");
  const stripped = (
    await postcss([tailwind({ base: process.cwd(), optimize: { minify: true } })]).process(
      globals.replace(/^@source not inline\("(?!dark:)[^"]+"\);\n/gm, ""),
      { from },
    )
  ).css;

  const listed = new Set([...uiExportList, ...strayWords].map(selectorOf));
  const before = classSelectors(layer(stripped, "utilities"));
  const after = classSelectors(real);
  assert.deepEqual([...listed].filter(name => !before.has(name)), [], "listed class is not a utility any more (stale entry)");
  assert.deepEqual([...listed].filter(name => after.has(name)), [], "listed class is still emitted (used somewhere the storefront scans)");
  const unexpected = [...before].filter(name => !after.has(name) && !listed.has(name) && !name.startsWith(".group\\/"));
  assert.deepEqual(unexpected, [], "the exclusions removed utilities that are not listed");
  assert.equal(layer(real, "components"), layer(stripped, "components"));
  assert.equal(layer(real, "base"), layer(stripped, "base"));
});
