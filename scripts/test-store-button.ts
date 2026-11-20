import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
