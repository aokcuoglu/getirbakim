import test from "node:test";
import assert from "node:assert/strict";
import { passForecast, type PassPace } from "../src/modules/admin/enrichment-pace";

const pace = (finished: number, windows: number): PassPace => ({ finished_24h: finished, active_windows_24h: windows, linked_products: 0, interval_ms: 10000, challenge_since: null, blocked: false });

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
