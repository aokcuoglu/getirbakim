import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateFeed, feedIssueCount, mode, feedNavTone, importErrorLabel, type FeedScope } from "../src/modules/suppliers/data-status";

const now = new Date("2026-11-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const scope = (list_group: string, patch: Partial<FeedScope> = {}): FeedScope => ({
  list_group, enabled: true, interval_minutes: 1440, stale_minutes: 2160, last_success_at: hoursAgo(2), consecutive_failures: 0, has_items: true, ...patch,
});

test("fresh data is current even when automatic sync is off", () => {
  // Başbuğ locally: every group disabled for the scheduler but refreshed by hand today.
  const status = evaluateFeed([scope("BMW", { enabled: false }), scope("VW", { enabled: false })], now);
  assert.equal(status.state, "fresh");
  assert.equal(status.tracked, 2);
  assert.equal(status.automated, 0);
  assert.equal(feedIssueCount(status), 0);
  assert.equal(feedNavTone(status), "success");
});

test("a disabled scope without products is history, not a gap", () => {
  const status = evaluateFeed([scope("HELLA"), scope("FALKON", { enabled: false, has_items: false, last_success_at: hoursAgo(800) })], now);
  assert.equal(status.state, "fresh");
  assert.equal(status.tracked, 1);
});

test("a disabled scope whose products are still shown must stay fresh", () => {
  const status = evaluateFeed([scope("A"), scope("B", { enabled: false, last_success_at: hoursAgo(72) })], now);
  assert.equal(status.state, "partial");
  assert.deepEqual(status.stale.map(s => s.list_group), ["B"]);
  assert.equal(feedNavTone(status), "warning");
});

test("all scopes past their SLA are stale, never-fetched scopes are counted once", () => {
  assert.equal(evaluateFeed([scope("A", { last_success_at: hoursAgo(40) })], now).state, "stale");
  const status = evaluateFeed([scope("A"), scope("B", { last_success_at: null, consecutive_failures: 2, has_items: false })], now);
  assert.equal(status.state, "partial");
  assert.equal(feedIssueCount(status), 1);
});

test("a failed retry of fresh data is an open issue but keeps the data current", () => {
  const status = evaluateFeed([scope("A"), scope("B", { consecutive_failures: 1, error_reason: "upstream: getStockList: HTTP 500" })], now);
  assert.equal(status.state, "fresh");
  assert.equal(feedIssueCount(status), 1);
  assert.equal(feedNavTone(status), "warning");
});

test("never fetched and unconfigured feeds", () => {
  assert.equal(evaluateFeed([scope("ALL", { last_success_at: null, has_items: false })], now).state, "never");
  assert.equal(evaluateFeed([], now).state, "never");
  assert.equal(evaluateFeed([scope("ALL")], now, false).state, "unconfigured");
});

test("import errors read as plain language", () => {
  assert.match(importErrorLabel("upstream: getStockList: HTTP 500"), /sunucusu hata/);
  assert.match(importErrorLabel("upstream: Auth: HTTP 401"), /erişimi reddetti/);
  assert.match(importErrorLabel("missing-stocks-increased-over-10-points"), /önceki veriyi korudu/);
  assert.match(importErrorLabel("product-drop-over-20-percent"), /küçüldü/);
});

// The previous implementation, kept as the reference for tie-breaking (stable sort by frequency, first element wins).
const previousMode = (input: number[]) => {
  const values = [...input];
  return values.length ? values.sort((a, b) => values.filter(v => v === b).length - values.filter(v => v === a).length)[0] : null;
};

test("mode picks the most frequent value and the earliest on a tie", () => {
  assert.equal(mode([]), null);
  assert.equal(mode([7]), 7);
  assert.equal(mode([1, 2, 2, 3]), 2);
  assert.equal(mode([3, 1, 1, 3]), 3);
  assert.equal(mode([1, 2, 2, 1]), 1);
  assert.equal(mode([5, 6, 6, 5, 7]), 5);
  const input = [4, 4, 9, 9, 9];
  assert.equal(mode(input), 9);
  assert.deepEqual(input, [4, 4, 9, 9, 9]);
});

test("mode matches the previous implementation on random arrays with ties", () => {
  let seed = 42;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let round = 0; round < 2000; round++) {
    const values = Array.from({ length: Math.floor(random() * 30) }, () => Math.floor(random() * 6));
    assert.equal(mode(values), previousMode(values), JSON.stringify(values));
  }
});

test("evaluateFeed reports the most common interval and stale window of its tracked scopes", () => {
  const status = evaluateFeed([
    scope("A", { interval_minutes: 60, stale_minutes: 120 }), scope("B", { interval_minutes: 1440, stale_minutes: 2160 }),
    scope("C", { interval_minutes: 1440, stale_minutes: 2160 }), scope("D", { enabled: false, has_items: false, interval_minutes: 5, stale_minutes: 120 }),
  ], now);
  assert.equal(status.intervalMinutes, 1440);
  assert.equal(status.staleMinutes, 2160);
  assert.equal(evaluateFeed([], now).intervalMinutes, null);
});
