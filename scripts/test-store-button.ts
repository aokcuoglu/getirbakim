import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

/** Storefront tsx sources: the (store) routes and the shared components, minus the admin panel and the stock ui. */
function storefrontSources() {
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) {
        if (!(dir.pathname.endsWith("/src/components/") && ["admin", "ui"].includes(entry.name))) walk(child);
      } else if (entry.name.endsWith(".tsx")) files.push(child.pathname);
    }
  };
  walk(new URL("../src/app/(store)/", import.meta.url));
  walk(new URL("../src/components/", import.meta.url));
  return files.map(path => ({ path, source: readFileSync(path, "utf8") }));
}

/** Each `<Button …>` opening tag, found by scanning to the first `>` outside braces and quotes. */
function buttonTags(source: string) {
  const tags: string[] = [];
  for (const match of source.matchAll(/<Button(?=[\s>])/g)) {
    let depth = 0;
    let quote = "";
    let end = match.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ""; continue; }
      if (depth === 0 && (char === '"' || char === "'")) quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

/** The text with every `storeButton(…)` call (balanced parentheses) cut out. */
function withoutStoreButton(text: string) {
  let result = text;
  for (let start = result.indexOf("storeButton("); start >= 0; start = result.indexOf("storeButton(")) {
    let depth = 0;
    let end = start + "storeButton".length;
    for (; end < result.length; end++) {
      if (result[end] === "(") depth++;
      else if (result[end] === ")" && --depth === 0) break;
    }
    result = result.slice(0, start) + result.slice(end + 1);
  }
  return result;
}

/** Same-file consts whose initialiser calls storeButton, as name -> initialiser line. */
function storeButtonConsts(source: string) {
  return new Map([...source.matchAll(/^\s*const (\w+)\s*=\s*(.*storeButton\(.*)$/gm)].map(([, name, init]) => [name, init]));
}

test("every storefront Button takes its size and colour from storeButton", () => {
  let scanned = 0;
  for (const { path, source } of storefrontSources()) {
    const consts = storeButtonConsts(source);
    for (const tag of buttonTags(source)) {
      scanned++;
      const classes = tag.match(/className=\{([\s\S]*)\}/)?.[1] ?? "";
      const viaConst = [...consts.keys()].some(name => new RegExp(`\\b${name}\\b`).test(classes));
      assert.ok(tag.includes("storeButton(") || viaConst, `${path}: ${tag.slice(0, 160)}`);
    }
  }
  assert.ok(scanned >= 90, `scanned ${scanned} Button tags`);
});

test("storeButton extras never override height, size, font size or the brand colour", () => {
  const forbidden = /(^|[\s"'`:])(min-h-\S|h-\d|size-\d|text-xs|text-\[\d+px\]|bg-brand|border-brand)/;
  for (const { path, source } of storefrontSources()) {
    const pieces = [...buttonTags(source), ...storeButtonConsts(source).values()];
    for (const piece of pieces) assert.doesNotMatch(withoutStoreButton(piece), forbidden, `${path}: ${piece.slice(0, 160)}`);
  }
});

test("dialog actions use storeButton; the destructive confirm is the danger tint", async () => {
  const dialog = await import("@/components/store-dialog-classes");
  assert.ok(!("storeDialogAction" in dialog));
  assert.match(storeButtonIntents.danger, /(^|\s)bg-destructive\/10(\s|$)/);
});
