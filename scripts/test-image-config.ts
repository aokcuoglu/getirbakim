import assert from "node:assert/strict";
import { test } from "node:test";
import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import nextConfig from "../next.config";
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
