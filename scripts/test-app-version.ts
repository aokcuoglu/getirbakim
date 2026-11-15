import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersion } from "../src/lib/app-version";

test("short commit id is appended to the package version", () => {
  const v = appVersion("0.25.0", "3af499c8f3ea");
  assert.equal(v.label, "v0.25.0 · 3af499c");
  assert.equal(v.commit, "3af499c");
});

test("a full uppercase SHA is cut to seven lowercase characters", () => {
  assert.equal(appVersion("0.25.0", "3AF499C8F3EA3AF499C8F3EA3AF499C8F3EA3AF4").commit, "3af499c");
});

test("development, empty or missing build reads as development", () => {
  for (const build of ["development", "", undefined]) {
    const v = appVersion("0.25.0", build);
    assert.equal(v.label, "v0.25.0 · geliştirme");
    assert.equal(v.commit, null);
  }
});

test("a leading v in the version is not doubled", () => {
  assert.equal(appVersion("v0.25.0", "3af499c8f3ea").label, "v0.25.0 · 3af499c");
});

test("a non-hex build id is cut to its first 12 characters", () => {
  assert.equal(appVersion("0.25.0", "release-2026-11-15-x").commit, "release-2026");
});

test("no version and no build", () => {
  assert.equal(appVersion(undefined, undefined).label, "geliştirme");
});
