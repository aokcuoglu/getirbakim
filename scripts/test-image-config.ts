import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import nextConfig from "../next.config";
import { productImageLimits } from "../src/modules/admin/product-image-limits";
import { getVehicleLogo } from "../src/modules/store/storefront-logos";

// The /_next/image setup for product and category images (#737).

const images = nextConfig.images!;
const id = "0b8f6a52-6c0e-4f7c-9d52-0a4d9b7e1c11";

test("only the media routes may be optimized", () => {
  assert.ok(hasLocalMatch(images.localPatterns, `/api/product-media/${id}`));
  assert.ok(hasLocalMatch(images.localPatterns, `/api/category-media/${id}`));
  assert.ok(hasLocalMatch(images.localPatterns, "/media/site/images/x.jpg"));
  assert.ok(!hasLocalMatch(images.localPatterns, `/api/product-media/${id}?x=1`));
  assert.ok(!hasLocalMatch(images.localPatterns, "/api/health"));
  assert.ok(!hasLocalMatch(images.localPatterns, "/brand/logo-light.svg"));
});

test("logos carry a version query, so they stay outside the patterns and unoptimized", () => {
  assert.ok(getVehicleLogo("BMW")?.src.includes("?"));
});

test("a small size set, WebP at one quality, a bounded disk cache", () => {
  assert.deepEqual(images.formats, ["image/webp"]);
  assert.deepEqual(images.qualities, [75]);
  assert.ok(Math.max(...images.imageSizes!) < Math.min(...images.deviceSizes!));
  assert.ok(images.maximumDiskCacheSize! > 0);
  assert.equal(images.customCacheHandler, undefined);
});

test("an optimized response may be as large as the biggest upload and import file", () => {
  assert.ok(images.maximumResponseBody! > productImageLimits.maxBytes);
  assert.ok(images.maximumResponseBody! > 10 * 1024 * 1024);
});

// With localPatterns a next/image that is not `unoptimized` and whose src is not a media route fails (400 in
// production). Every such <Image> must be listed here as "file :: src expression"; a new one fails the test.
const optimizedImages = new Set([
  "src/app/(store)/sepet/page.tsx :: image.src",
  "src/app/(store)/bakim-robotu/kit-builder.tsx :: selected.image.src",
  // m.image is CatalogProductImage.src, set by listingCardModel / homeCardModel (#1212).
  "src/components/catalog-product-card.tsx :: m.image",
  "src/components/category-cards.tsx :: category.imagePath",
  "src/components/home-controls.tsx :: category.imagePath",
  "src/components/home-product-card-view.tsx :: m.image",
  // The fallback collection slide (a subcategory's imagePath, #1295).
  "src/components/home-static.tsx :: image",
  "src/components/navigation/category-menu.tsx :: category.imagePath",
  "src/components/navigation/category-parts.tsx :: category.imagePath",
  "src/components/product-gallery.tsx :: image.src",
  "src/components/product-gallery.tsx :: thumbnail.src",
  "src/components/purchase-form.tsx :: p.image",
  "src/components/purchase-form.tsx :: state.added.image",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** The text of each `<Image ...>` opening tag: braces and quotes are skipped so `=>` or `>` inside an attribute does not end it. */
function imageTags(code: string): string[] {
  const tags: string[] = [];
  for (const match of code.matchAll(/<Image\s/g)) {
    let depth = 0, quote = "";
    for (let i = match.index; i < code.length; i++) {
      const c = code[i];
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) { tags.push(code.slice(match.index, i + 1)); break; }
    }
  }
  return tags;
}

test("every next/image that is not unoptimized shows a known media source", () => {
  const found = new Set<string>();
  for (const file of sourceFiles(join(process.cwd(), "src"))) {
    const code = readFileSync(file, "utf8");
    if (!code.includes('from "next/image"')) continue;
    for (const tag of imageTags(code)) {
      if (/\sunoptimized[\s/>]/.test(tag)) continue;
      const src = /\ssrc=\{([^}]*)\}/.exec(tag)?.[1] ?? /\ssrc="([^"]*)"/.exec(tag)?.[1] ?? "?";
      found.add(`${relative(process.cwd(), file)} :: ${src}`);
    }
  }
  const unknown = [...found].filter((entry) => !optimizedImages.has(entry));
  assert.deepEqual(unknown, [], "These <Image> elements are not unoptimized and not on the media list. If the src is always /api/product-media/<id> or /api/category-media/<id>, add \"file :: src\" to optimizedImages in scripts/test-image-config.ts; otherwise add `unoptimized`.");
  const gone = [...optimizedImages].filter((entry) => !found.has(entry));
  assert.deepEqual(gone, [], "These optimizedImages entries no longer match an <Image>; remove them from scripts/test-image-config.ts.");
});
