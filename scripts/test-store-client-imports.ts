import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Zod is ~90 kB of transfer; one "use client" file that reaches it ships it to every storefront page (#968).
const adminRoots = ["src/components/admin", "src/app/yonetim"];
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
})("src");

const head = (text: string) => text.slice(0, 200);
const isClient = (text: string) => /^\s*(?:\/\/.*\n\s*)*"use client"/.test(head(text));
const isServerOnly = (text: string) => /^\s*(?:\/\/.*\n\s*)*"use server"/.test(head(text));

function resolve(from: string, specifier: string) {
  const base = specifier.startsWith("@/") ? path.join("src", specifier.slice(2)) : specifier.startsWith(".") ? path.join(path.dirname(from), specifier) : undefined;
  if (!base) return undefined;
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function imports(text: string) {
  return [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map(match => match[1]);
}

function zodChain(file: string, seen = new Set<string>()): string[] | undefined {
  if (seen.has(file)) return undefined;
  seen.add(file);
  const text = fs.readFileSync(file, "utf8");
  if (isServerOnly(text)) return undefined;
  for (const specifier of imports(text)) {
    if (specifier === "zod" || specifier.startsWith("zod/")) return [file];
    const target = resolve(file, specifier);
    if (target && !adminRoots.some(root => target.startsWith(root))) {
      const chain = zodChain(target, seen);
      if (chain) return [file, ...chain];
    }
  }
  return undefined;
}

test("no storefront client component reaches zod", () => {
  const found = files
    .filter(file => !adminRoots.some(root => file.startsWith(root)) && isClient(fs.readFileSync(file, "utf8")))
    .map(file => zodChain(file))
    .filter((chain): chain is string[] => Boolean(chain))
    .map(chain => chain.join(" -> "));
  assert.deepEqual(found, []);
});
