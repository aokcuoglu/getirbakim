import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { imports, resolve, sourceFiles } from "./test-helpers/import-graph";

// Zod is ~90 kB of transfer; one "use client" file that reaches it ships it to every storefront page (#968).
const adminRoots = ["src/components/admin", "src/app/yonetim"];
const files = sourceFiles("src");

const head = (text: string) => text.slice(0, 200);
const isClient = (text: string) => /^\s*(?:\/\/.*\n\s*)*"use client"/.test(head(text));
const isServerOnly = (text: string) => /^\s*(?:\/\/.*\n\s*)*"use server"/.test(head(text));

/** The static import chain from `file` to a module matching `match`, if any (`import()` is not followed). */
function chainTo(file: string, match: (specifier: string) => boolean, seen = new Set<string>()): string[] | undefined {
  if (seen.has(file)) return undefined;
  seen.add(file);
  const text = fs.readFileSync(file, "utf8");
  if (isServerOnly(text)) return undefined;
  for (const specifier of imports(text)) {
    if (match(specifier)) return [file, specifier];
    const target = resolve(file, specifier);
    if (target && !adminRoots.some(root => target.startsWith(root))) {
      const chain = chainTo(target, match, seen);
      if (chain) return [file, ...chain];
    }
  }
  return undefined;
}

const isZod = (specifier: string) => specifier === "zod" || specifier.startsWith("zod/");

test("no storefront client component reaches zod", () => {
  const found = files
    .filter(file => !adminRoots.some(root => file.startsWith(root)) && isClient(fs.readFileSync(file, "utf8")))
    .map(file => chainTo(file, isZod))
    .filter((chain): chain is string[] => Boolean(chain))
    .map(chain => chain.join(" -> "));
  assert.deepEqual(found, []);
});

// The header and the cookie banner are on every storefront page; their sheets, popover and checkboxes load on first intent
// through `lazyModule(() => import(...))` (#1017). A static import would put Base UI's dialog stack back into every page.
const headerRoots = ["src/components/layout/site-header.tsx", "src/components/privacy/cookie-consent.tsx", "src/components/garage/garage-button.tsx"];
const deferred = ["@base-ui/react/dialog", "@base-ui/react/popover", "@base-ui/react/checkbox", "@base-ui/react/tabs"];

test("header never statically reaches the deferred Base UI modules", () => {
  const found = headerRoots
    .map(root => chainTo(root, specifier => deferred.includes(specifier)))
    .filter((chain): chain is string[] => Boolean(chain))
    .map(chain => chain.join(" -> "));
  assert.deepEqual(found, []);
});

test("the deferred modules are still reached through import()", () => {
  for (const [file, target] of [
    ["src/components/garage/garage-button.tsx", "./vehicle-sheet"],
    ["src/components/navigation/category-menu.tsx", "./category-sheet"],
    ["src/components/auth/account-menu.tsx", "./account-panel"],
    ["src/components/privacy/cookie-consent.tsx", "./cookie-settings"],
  ]) assert.match(fs.readFileSync(file, "utf8"), new RegExp(`import\\("${target.replace(".", "\\.")}"\\)`), file);
});

// #1213: a server component that imports lucide puts the icon definition and long dedupe references into the RSC flight.
// Storefront server files use StoreIcon (a name-keyed client wrapper); this list only shrinks; it is empty since #1333.
const lucideAllowlist: string[] = [];

// Permanent: no "use client" directive, but every importer is a client component, so it is client by inheritance and costs no flight.
const lucideInherited = ["src/components/navigation/category-parts.tsx"];

test("storefront server components do not import lucide-react", () => {
  const importing = files
    .filter(file => (file.startsWith("src/app/(store)/") || file.startsWith("src/components/")) && !file.startsWith("src/components/ui/") && !file.startsWith("src/components/admin/"))
    .filter(file => { const text = fs.readFileSync(file, "utf8"); return !isClient(text) && imports(text).includes("lucide-react"); })
    .sort();
  const unexpected = importing.filter(file => !lucideAllowlist.includes(file) && !lucideInherited.includes(file));
  assert.deepEqual(unexpected, [], "use StoreIcon from @/components/site/store-icon in storefront server components");
  const stale = [...lucideAllowlist, ...lucideInherited].filter(file => !importing.includes(file));
  assert.deepEqual(stale, [], "these files no longer import lucide-react: remove them from the allowlist");
});
