import assert from "node:assert/strict";
import test from "node:test";
import { checkCssChunks, readManifest } from "./css-chunks.mjs";

const store = { path: "static/chunks/store.css" };
const admin = { path: "static/chunks/admin.css" };
const adminChunks = new Set([admin.path]);

test("reads the routes a manifest file defines", () => {
  const code = 'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/sepet/page"] = {"entryCSSFiles":{"[project]/src/app/layout":[{"path":"static/chunks/store.css","inlined":false}]}};';
  assert.deepEqual(Object.keys(readManifest(code)), ["/sepet/page"]);
});

test("passes when only /yonetim links the workspace chunk, after the storefront sheet", () => {
  const manifests = {
    "/sepet/page": { entryCSSFiles: { "[project]/src/app/layout": [store] } },
    "/yonetim/page": { entryCSSFiles: { "[project]/src/app/layout": [store], "[project]/src/app/yonetim/layout": [store, admin] } },
  };
  assert.deepEqual(checkCssChunks(manifests, adminChunks), []);
});

test("flags a storefront segment that links the workspace chunk", () => {
  const manifests = {
    "/sepet/page": { entryCSSFiles: { "[project]/src/app/(store)/sepet/page": [store, admin] } },
    "/yonetim/page": { entryCSSFiles: { "[project]/src/app/yonetim/page": [store, admin] } },
  };
  assert.match(checkCssChunks(manifests, adminChunks).join("\n"), /\/sepet\/page: .* links the workspace chunk static\/chunks\/admin\.css/);
});

test("flags a workspace segment that loads admin.css first or not at all", () => {
  const before = { "/yonetim/page": { entryCSSFiles: { "[project]/src/app/yonetim/page": [admin, store] } } };
  assert.match(checkCssChunks(before, adminChunks).join("\n"), /before the storefront sheet/);
  const missing = { "/yonetim/page": { entryCSSFiles: { "[project]/src/app/yonetim/page": [store] } } };
  assert.match(checkCssChunks(missing, adminChunks).join("\n"), /does not link the workspace chunk/);
});

test("flags a build without any /yonetim segment", () => {
  assert.deepEqual(checkCssChunks({ "/page": { entryCSSFiles: { "[project]/src/app/layout": [store] } } }, adminChunks), ["no /yonetim segment found in the manifests"]);
});
