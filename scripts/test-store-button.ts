import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { storeButton, storeButtonIntents, storeButtonSizes } from "@/components/store-button";

// Storefront button scale and colour roles (#1091, DESIGN.md "Buttons and controls").
const css = (file: string) => readFileSync(new URL(`../src/app/${file}`, import.meta.url), "utf8");
const globals = css("globals.css");
const storefront = css("storefront.css");

/** The storefront :root block's custom properties (the first `:root {`; the admin overrides are `:root:has(...)`). */
function storefrontTokens() {
  const start = globals.indexOf(":root {");
  assert.ok(start >= 0, "storefront :root block");
  const block = globals.slice(start, globals.indexOf("}", start));
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Tailwind spacing steps (0.25rem each) set by an unprefixed min-h-N / size-N class. */
function steps(classes: string, utility: "min-h" | "size") {
  const match = classes.split(/\s+/).find(name => name.startsWith(`${utility}-`));
  return match ? Number(match.slice(utility.length + 1)) : undefined;
}

test("every storefront button size is at least 44px tall on touch widths", () => {
  for (const [size, classes] of Object.entries(storeButtonSizes)) {
    const height = steps(classes, "min-h") ?? steps(classes, "size");
    assert.ok(height !== undefined && height >= 11, `${size}: ${classes}`);
  }
  assert.ok((steps(storeButtonSizes.icon, "size") ?? 0) >= 11, "icon buttons are 44×44");
});

test("storefront button labels are never under 14px", () => {
  const small = /(^|\s|:)text-(xs|\[(1[0-3]|[0-9])px\])(\s|$)/;
  for (const [name, classes] of Object.entries({ ...storeButtonSizes, ...storeButtonIntents })) assert.doesNotMatch(classes, small, name);
  for (const intent of Object.keys(storeButtonIntents) as (keyof typeof storeButtonIntents)[])
    for (const size of Object.keys(storeButtonSizes) as (keyof typeof storeButtonSizes)[])
      assert.doesNotMatch(storeButton({ intent, size }), small, `${intent}/${size}`);
  assert.match(storeButton({ intent: "primary", size: "lg" }), /(^|\s)text-base(\s|$)/);
  assert.match(storeButton({ intent: "primary", size: "lg" }), /(^|\s)font-semibold(\s|$)/);
});

test("every storefront button has a 2px primary focus outline", () => {
  const classes = storeButton();
  for (const name of ["focus-visible:outline-2", "focus-visible:outline-solid", "focus-visible:outline-ring"]) assert.ok(classes.split(" ").includes(name), name);
});

test("storefront colour tokens meet the contrast the roles promise", () => {
  const tokens = storefrontTokens();
  const token = (name: string) => {
    const value = tokens.get(name);
    assert.ok(value, `--${name}`);
    return value;
  };
  assert.ok(contrast(token("control-border"), "#ffffff") >= 3, "outline border on white ≥ 3:1");
  assert.ok(contrast(token("accent-foreground"), token("accent")) >= 4.5, "secondary text on its tint ≥ 4.5:1");
  assert.ok(contrast(token("primary-foreground"), token("primary")) >= 4.5, "primary label ≥ 4.5:1");
  assert.match(globals, /--color-control-border:\s*var\(--control-border\)/);
});

test("the purchase form's button keeps 14px text and the primary colour", () => {
  const rule = storefront.match(/\.buy-button \{ @apply ([^;]+);/)?.[1];
  assert.ok(rule, ".buy-button rule");
  assert.doesNotMatch(rule, /text-xs|text-\[1[0-3]px\]/);
  assert.match(rule, /(^|\s)bg-primary(\s|$)/);
  const product = storefront.match(/\.buy-button-product \{ @apply ([^;]+);/)?.[1];
  assert.ok(product, ".buy-button-product rule");
  assert.doesNotMatch(product, /#2e78c7/);
});

/**
 * Storefront tsx sources: the (store) routes and the shared components, minus the admin panel and the stock ui.
 * `<Button>` elements are checked for storeButton; raw `<button>` elements are counted per file (see rawButtons).
 */
function storefrontSources() {
  const files: string[] = [];
  const walk = (dir: URL, skip: string[] = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && skip.includes(entry.name)) continue;
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".tsx")) files.push(fileURLToPath(child));
    }
  };
  walk(new URL("../src/app/(store)/", import.meta.url));
  walk(new URL("../src/components/", import.meta.url), ["admin", "ui"]);
  return files.map(path => ({ path, source: readFileSync(path, "utf8") }));
}

/** Index of the character that closes the bracket opened at `open` (braces, parentheses), skipping quoted strings. */
function closing(source: string, open: number, openChar: string, closeChar: string) {
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) { if (char === quote && source[i - 1] !== "\\") quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === openChar) depth++;
    else if (char === closeChar && --depth === 0) return i;
  }
  return source.length - 1;
}

/** Each `<name …>` opening tag (`Button` by default), found by scanning to the first `>` outside braces and quotes. */
function buttonTags(source: string, name = "Button") {
  const tags: string[] = [];
  for (const match of source.matchAll(new RegExp(`<${name}(?=[\\s>])`, "g"))) {
    let end = match.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "{") end = closing(source, end, "{", "}");
      else if (char === '"') end = source.indexOf('"', end + 1);
      else if (char === ">") break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

/** The `className={…}` expression of a tag, without the braces. */
function classExpression(tag: string) {
  const start = tag.indexOf("className={");
  if (start < 0) return "";
  const open = start + "className=".length;
  return tag.slice(open + 1, closing(tag, open, "{", "}"));
}

/** The text with every `storeButton(…)` call cut out. */
function withoutStoreButton(text: string) {
  let result = text;
  for (let start = result.indexOf("storeButton("); start >= 0; start = result.indexOf("storeButton(")) {
    const open = start + "storeButton".length;
    result = result.slice(0, start) + result.slice(closing(result, open, "(", ")") + 1);
  }
  return result;
}

/** Every same-file `const name = …` initialiser (string literal, call, object or array), to follow className references. */
function allConsts(source: string) {
  const consts = new Map<string, string>();
  for (const match of source.matchAll(/^\s*(?:export )?const (\w+)(?::[^=\n]+)?\s*=\s*/gm)) {
    const start = match.index + match[0].length;
    const first = source[start];
    let end: number;
    if (first === '"' || first === "'" || first === "`") end = source.indexOf(first, start + 1);
    else {
      const open = source.slice(start).search(/[({[]/);
      const char = open < 0 ? "" : source[start + open];
      end = open < 0 ? source.indexOf("\n", start) : closing(source, start + open, char, char === "(" ? ")" : char === "{" ? "}" : "]");
    }
    consts.set(match[1], source.slice(start, end + 1));
  }
  return consts;
}

/** Same-file `const name = cn(…)` / `storeButton(…)` initialisers (multi-line, `export const` included) that call storeButton. */
function storeButtonConsts(source: string) {
  const consts = new Map<string, string>();
  for (const match of source.matchAll(/^\s*(?:export )?const (\w+)\s*=\s*(cn|storeButton)\(/gm)) {
    const open = match.index + match[0].length - 1;
    const init = source.slice(open - match[2].length, closing(source, open, "(", ")") + 1);
    if (init.includes("storeButton(")) consts.set(match[1], init);
  }
  return consts;
}

test("every storefront Button takes its size and colour from storeButton", () => {
  let scanned = 0;
  for (const { path, source } of storefrontSources()) {
    const consts = storeButtonConsts(source);
    for (const tag of buttonTags(source)) {
      scanned++;
      const classes = classExpression(tag);
      const viaConst = [...consts.keys()].some(name => new RegExp(`\\b${name}\\b`).test(classes));
      assert.ok(classes.includes("storeButton(") || viaConst, `${path}: ${tag.slice(0, 160)}`);
    }
  }
  assert.ok(scanned >= 90, `scanned ${scanned} Button tags`);
});

test("storeButton extras never override height, size, font size or the brand colour", () => {
  const forbidden = /(^|[\s"'`:!])!?(min-h-\S|h-\S|size-\S|text-(xs|sm|base|lg|\[\d+px\])|bg-brand|border-brand)/;
  for (const { path, source } of storefrontSources()) {
    const consts = storeButtonConsts(source);
    const resolved = (tag: string) => {
      const classes = classExpression(tag);
      return [classes, ...[...consts].filter(([name]) => new RegExp(`\\b${name}\\b`).test(classes)).map(([, init]) => init)];
    };
    for (const tag of buttonTags(source))
      for (const piece of resolved(tag)) assert.doesNotMatch(withoutStoreButton(piece), forbidden, `${path}: ${tag.slice(0, 160)}`);
    for (const [name, init] of consts) assert.doesNotMatch(withoutStoreButton(init), forbidden, `${path}: const ${name}`);
  }
});

test("dialog actions use storeButton; the destructive confirm is the danger tint", async () => {
  const dialog = await import("@/components/store-dialog-classes");
  assert.ok(!("storeDialogAction" in dialog));
  assert.match(storeButtonIntents.danger, /(^|\s)bg-destructive\/10(\s|$)/);
});

/** Raw `<button>` elements allowed per file (path suffix → count): header components and the documented exceptions. */
const rawButtons: Record<string, number> = {
  "navigation/category-menu.tsx": 7, // header: mega-menu triggers
  "navigation/category-sheet.tsx": 3, // header: mobile category sheet
  "navigation/search-box.tsx": 3, // header: search box controls
  "navigation/header-tools.tsx": 1, // header: tool trigger
  "auth/account-menu.tsx": 1, // header: account menu trigger
  "garage/garage-button.tsx": 1, // garage trigger: header/hero/home/catalog/product variants share one element
  "bakim-robotu/kit-builder.tsx": 1, // package card: a rich selectable card, not a chip
  "components/catalog-card-controls.tsx": 1, // card specs toggle
  "components/product-gallery.tsx": 1, // thumbnail: an image selector
  "privacy/cookie-consent.tsx": 1, // footer cookie link
};

test("raw <button> elements appear only in the header and the listed exceptions", () => {
  const sources = storefrontSources();
  for (const suffix of Object.keys(rawButtons)) assert.ok(sources.some(({ path }) => path.endsWith(suffix)), `${suffix} exists`);
  for (const { path, source } of sources) {
    const expected = Object.entries(rawButtons).find(([suffix]) => path.endsWith(suffix))?.[1] ?? 0;
    assert.equal((source.match(/<button(?=[\s>])/g) ?? []).length, expected, path);
  }
});

test("no hex colour on a storefront button, trigger or close tag", () => {
  const hex = /#[0-9a-f]{3,8}\b/i;
  let scanned = 0;
  const discovered = new Set<string>();
  for (const { path, source } of storefrontSources()) {
    if (path.includes("/components/navigation/") || path.endsWith("/auth/account-menu.tsx")) continue;
    const consts = allConsts(source);
    // Only plain `<XTrigger` / `<XClose` tags are discovered; dotted (`<Menu.Trigger`) or aliased tags are not seen.
    const found = [...source.matchAll(/<(\w+(?:Trigger|Close))(?=[\s>])/g)].map((m) => m[1]);
    for (const name of found) discovered.add(name);
    const names = new Set(["button", "Button", "DialogClose", "SheetClose", ...found]);
    for (const name of names)
      for (const tag of buttonTags(source, name)) {
        scanned++;
        assert.doesNotMatch(tag, hex, `${path}: ${tag.slice(0, 160)}`);
        const classes = classExpression(tag);
        for (const [constName, init] of consts) if (new RegExp(`\\b${constName}\\b`).test(classes)) assert.doesNotMatch(init, hex, `${path}: const ${constName}`);
      }
    if (path.endsWith("/garage/garage-button.tsx")) assert.doesNotMatch(source.slice(source.indexOf("const variantClass"), source.indexOf("export function")), hex, `${path}: variantClass`);
  }
  assert.ok(scanned >= 15, `scanned ${scanned} button, trigger and close tags`);
  assert.ok(discovered.size >= 8, `discovered ${discovered.size} Trigger/Close names`);
  for (const name of ["TabsTrigger", "SelectTrigger", "DialogTrigger"]) assert.ok(discovered.has(name), `${name} was not seen`);
});

test("the card specs toggle is a 14px label with a 44px target", () => {
  const rule = css("catalog-card.css").split("\n").find((line) => line.includes(".product-card-specs-toggle {"));
  assert.ok(rule, "rule present");
  for (const name of ["min-h-11", "text-sm"]) assert.ok(rule.split(/\s+/).includes(name), name);
  assert.doesNotMatch(rule, /text-xs|min-h-0|text-\[1[0-3]px\]/);
});
