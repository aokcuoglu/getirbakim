import test from "node:test";
import assert from "node:assert/strict";
import { passForecast, summarizeSources, type PassPace } from "../src/modules/admin/enrichment-pace";

const pace = (finished: number, windows: number, fallback = 0): PassPace => ({ finished_24h: finished, active_windows_24h: windows, linked_products: 0, fallback_pending_found_24h: fallback, interval_ms: 10000, challenge_since: null, blocked: false });

test("pace counts only hours the source answered", () => {
  const forecast = passForecast(pace(840, 72), 8400);
  assert.equal(forecast.activeHours, 12);
  assert.equal(forecast.uptime, 0.5);
  assert.equal(forecast.perActiveHour, 70);
  assert.equal(forecast.daysLeft, 10);
  assert.equal(forecast.daysLeftAlwaysOn, 5);
});
test("an idle day gives no forecast instead of infinity", () => {
  const forecast = passForecast(pace(0, 0), 1000);
  assert.equal(forecast.perActiveHour, 0);
  assert.equal(forecast.daysLeft, null);
  assert.equal(forecast.daysLeftAlwaysOn, null);
});
test("products spareto found in the pending queue shorten the forecast; Trodo's hourly pace stays its own", () => {
  const forecast = passForecast(pace(840, 72, 160), 10000);
  assert.equal(forecast.perActiveHour, 70);
  assert.equal(forecast.daysLeft, 10);
  assert.equal(forecast.daysLeftAlwaysOn, 10000 / (70 * 24 + 160));
});
test("each source gets its own row, state and hit rate", () => {
  const now = Date.parse("2026-10-18T12:00:00Z"), ago = (minutes: number) => new Date(now - minutes * 60_000);
  const rows = summarizeSources([
    { source: "spareto", searched: 300, found: 84, errors: 1, last: ago(1), last_outcome: "not_found" },
    { source: "trodo", searched: 527, found: 480, errors: 2, last: ago(3), last_outcome: null },
    { source: "otoparcasan", searched: 12, found: 3, errors: 0, last: ago(50), last_outcome: "found" },
  ], { "www.trodo.com": 8655, "otoparcasan.com": 4381, "spareto.com": 212, "": 3 }, false, now);
  assert.deepEqual(rows.map(r => [r.source, r.state, r.written]), [["trodo", "running", 8655], ["otoparcasan", "idle", 4381], ["spareto", "running", 212]]);
  assert.equal(rows[2].hitRate, 0.28);
  const blocked = summarizeSources([{ source: "spareto", searched: 0, found: 0, errors: 0, last: ago(1), last_outcome: "blocked" }], {}, true, now);
  assert.deepEqual(blocked.map(r => [r.state, r.hitRate, r.written]), [["blocked", null, 0], ["idle", null, 0], ["blocked", null, 0]]);
});
