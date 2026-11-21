import test from "node:test";
import assert from "node:assert/strict";
import { fitsBumpDue, fitsBumpIntervalMs } from "../src/modules/store/listing-bump";

// The background link sync bumps the listing epoch after it changed fit rows (#956), at most once per interval.
test("a fit change bumps at once after a quiet period, then at most once per interval", () => {
  const now = 1_000_000;
  assert.equal(fitsBumpDue(false, 0, now), false, "nothing changed");
  assert.equal(fitsBumpDue(true, 0, now), true, "the first change bumps at once");
  assert.equal(fitsBumpDue(true, now - 5_000, now), false, "a change right after a bump waits");
  assert.equal(fitsBumpDue(true, now - fitsBumpIntervalMs, now), true, "and bumps once the interval passed");
  assert.equal(fitsBumpDue(false, now - fitsBumpIntervalMs, now), false, "no pending change, no bump");
  assert.equal(fitsBumpDue(true, now - 1_000, now, 1_000), true, "the interval is configurable");
});
