import fs from "node:fs";
import path from "node:path";

/** Every .ts/.tsx file under `dir`, recursively. */
export function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  (function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  })(dir);
  return files;
}

/** The project file an `@/…` or relative specifier points to, or undefined for packages and missing files. */
export function resolve(from: string, specifier: string) {
  const base = specifier.startsWith("@/") ? path.join("src", specifier.slice(2)) : specifier.startsWith(".") ? path.join(path.dirname(from), specifier) : undefined;
  if (!base) return undefined;
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/** Static value imports and re-exports (`import … from "x"`, `export … from 'x'`, either quote); `import type` is skipped. */
export function imports(text: string) {
  return [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map(match => match[1]);
}

/** Every specifier a module loads at runtime: static imports, side-effect `import "x"` and `import("x")`. */
export function allImports(text: string) {
  return [
    ...imports(text),
    ...[...text.matchAll(/^import\s+["']([^"']+)["']/gm)].map(match => match[1]),
    ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]),
  ];
}

/**
 * The .ts/.tsx files reachable from `roots` through `allImports`, each mapped to the file that first imported it
 * (undefined for a root). `chain(reached, file)` turns that into a readable root → … → file path.
 */
export function reach(roots: string[], skip: (file: string) => boolean = () => false) {
  const parent = new Map<string, string | undefined>();
  const queue: string[] = [];
  for (const root of roots) {
    if (parent.has(root)) continue;
    parent.set(root, undefined);
    queue.push(root);
  }
  while (queue.length) {
    const file = queue.shift() as string;
    for (const specifier of allImports(fs.readFileSync(file, "utf8"))) {
      const target = resolve(file, specifier);
      if (!target || !/\.tsx?$/.test(target) || parent.has(target) || skip(target)) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  return parent;
}

export function chain(reached: Map<string, string | undefined>, file: string) {
  const links: string[] = [];
  for (let current: string | undefined = file; current; current = reached.get(current)) links.unshift(current);
  return links.join(" -> ");
}
