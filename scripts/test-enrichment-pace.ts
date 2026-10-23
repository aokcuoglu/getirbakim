import test from "node:test";
import assert from "node:assert/strict";
import { partialGaps, passForecast, summarizeSources, type PassPace } from "../src/modules/admin/enrichment-pace";
import { completeWithImage, imageNote, keepsRicherPartial } from "../src/modules/enrichment/partial-gaps";

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

test("partial gaps name what each adapter could not collect", () => {
  assert.deepEqual(partialGaps("Durable public browser adapter v2; run x; exact brand/part verified; source IDs covered 12/14; invalid rows 3", false), ["image", "unresolved_vehicles", "invalid_rows"]);
  assert.deepEqual(partialGaps("spareto.com public HTTP adapter v1; exact brand/part verified; vehicles not collected", true), ["vehicles_not_collected"]);
  assert.deepEqual(partialGaps("spareto.com public HTTP adapter v2; x; vehicle models 3/5; catalog-resolved 40/52; invalid rows 0", true), ["unresolved_vehicles"]);
  assert.deepEqual(partialGaps("otoparcasan.com public HTTP adapter v1; x; commercial vehicles dropped 0; invalid rows 2; failed makes 1", true), ["invalid_rows", "failed_makes"]);
  assert.deepEqual(partialGaps("spareto.com public HTTP adapter v2; x; vehicle models 0/0; catalog-resolved 0/0; invalid rows 0; no image; no vehicles listed", false), ["image", "no_vehicles"]);
  assert.deepEqual(partialGaps(null, true), []);
});

test("an image completes a partial product only when it was the last gap", () => {
  const trodo = "Durable public browser adapter v2; run x; exact brand/part verified; source IDs covered 14/14; invalid rows 0";
  assert.equal(completeWithImage(imageNote(trodo, "https://otoparcasan.com/img/1.jpg")), true);
  assert.equal(completeWithImage(imageNote(trodo.replace("14/14", "12/14"), "https://otoparcasan.com/img/1.jpg")), false);
  const spareto = "spareto.com public HTTP adapter v2; x; vehicle models 0/0; catalog-resolved 0/0; invalid rows 0; no image; no vehicles listed";
  const note = imageNote(spareto, "https://cdn.spareto.com/variants/1.jpg");
  assert.equal(note, "spareto.com public HTTP adapter v2; x; vehicle models 0/0; catalog-resolved 0/0; invalid rows 0; no vehicles listed; image from cdn.spareto.com");
  assert.equal(completeWithImage(note), false);
  assert.deepEqual(partialGaps(note, true), ["no_vehicles"]);
});

test("a partial from another source is refused only when it lists fewer vehicles", () => {
  const spareto = { source: "https://spareto.com/products/x/y", vehicles: 40 };
  assert.equal(keepsRicherPartial(spareto, { source: "https://www.trodo.com/x", vehicles: 12 }), true);
  assert.equal(keepsRicherPartial(spareto, { source: "https://www.trodo.com/x", vehicles: 40 }), false);
  assert.equal(keepsRicherPartial(spareto, { source: "https://www.trodo.com/x", vehicles: 90 }), false);
  assert.equal(keepsRicherPartial(spareto, { source: "https://spareto.com/products/x/z", vehicles: 0 }), false);
});
