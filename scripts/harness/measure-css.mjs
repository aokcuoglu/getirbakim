// Usage: node scripts/harness/measure-css.mjs [file.css ...] [--next] [--breakdown]
// Stylesheet weight probe (#1027), no dependencies beyond the project's own PostCSS + Tailwind: compiles each sheet the
// way the build does (minified) and prints its raw and gzip -9 size. Defaults to the storefront sheet
// (src/app/globals.css) and the workspace sheet (src/app/admin.css). --next also lists the CSS chunks of the last
// `npm run build` (.next/static/chunks/*.css) and marks the one carrying the /yonetim sidebar utilities.
// --breakdown prints bytes per top-level block (@layer theme/base/components/utilities, @property, other) of each sheet.
// Not part of CI; scripts/test-stylesheet-scope.ts uses `compileCss` for its output checks.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { adminSentinel } from "./css-chunks.mjs";

/** Compiles one stylesheet with the project's Tailwind plugin; `minify: false` keeps it readable for assertions. */
export async function compileCss(file, { minify = true } = {}) {
  const from = path.resolve(file);
  const result = await postcss([tailwind({ base: process.cwd(), optimize: minify ? { minify: true } : false })]).process(readFileSync(from, "utf8"), { from });
  return result.css;
}

export const gzipSize = (text) => gzipSync(text, { level: 9 }).length;

export { adminSentinel };

const kb = (bytes) => (bytes / 1024).toFixed(1);

/** Raw bytes per top-level block of a minified sheet, keyed by `@layer <name>`, `@property` or `other`. */
export function breakdown(css) {
  const sizes = new Map();
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === "{") depth++;
    else if (char === "}" || char === ";") {
      if (char === "}") depth--;
      if (depth > 0 || (char === ";" && depth !== 0)) continue;
      const block = css.slice(start, index + 1);
      start = index + 1;
      const head = block.trimStart().match(/^@(layer\s+[\w-]+(?=\s*\{)|property)/)?.[1]?.replace(/\s+/, " ") ?? "other";
      sizes.set(head, (sizes.get(head) ?? 0) + Buffer.byteLength(block));
    }
  }
  return sizes;
}

async function main() {
  const argv = process.argv.slice(2);
  const next = argv.includes("--next");
  const showBreakdown = argv.includes("--breakdown");
  const files = argv.filter((arg) => !arg.startsWith("--"));
  const rows = [];
  for (const file of files.length ? files : ["src/app/globals.css", "src/app/admin.css"]) {
    if (!existsSync(file)) {
      rows.push([file, "-", "-", "missing"]);
      continue;
    }
    const css = await compileCss(file);
    rows.push([file, kb(Buffer.byteLength(css)), kb(gzipSize(css)), css.includes(adminSentinel) ? "admin" : ""]);
    if (showBreakdown) for (const [name, bytes] of breakdown(css)) rows.push([`  ${name}`, kb(bytes), "", ""]);
  }
  if (next) {
    const dir = ".next/static/chunks";
    const chunks = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".css")).sort() : [];
    if (!chunks.length) rows.push([`${dir}/*.css`, "-", "-", "no build"]);
    for (const name of chunks) {
      const css = readFileSync(path.join(dir, name), "utf8");
      rows.push([`${dir}/${name}`, kb(Buffer.byteLength(css)), kb(gzipSize(css)), css.includes(adminSentinel) ? "admin" : ""]);
    }
  }
  const header = ["stylesheet", "rawKB", "gzipKB", "note"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => String(row[column]).length)));
  for (const row of [header, ...rows]) console.log(row.map((cell, column) => (column === 0 || column === 3 ? String(cell).padEnd(widths[column]) : String(cell).padStart(widths[column]))).join("  ").trimEnd());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
