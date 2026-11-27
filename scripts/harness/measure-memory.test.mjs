import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crawlerPattern, defaultUserAgent, isCrawlerAgent, listingVariants, probeArmed, searchAllowed, searchPaths } from "./memory-urls.mjs";

test("the default user agent is a crawler, so searches are not recorded", () => {
  assert.ok(isCrawlerAgent(defaultUserAgent));
  assert.ok(searchAllowed(defaultUserAgent));
  assert.ok(!searchAllowed("getirbakim-memory-probe"));
  assert.ok(!searchAllowed("Mozilla/5.0"));
  assert.ok(!searchAllowed(undefined));
});

test("search paths exist only for a crawler user agent", () => {
  assert.deepEqual(searchPaths(["fren balata", " ", "yağ filtresi"], defaultUserAgent), ["/katalog?q=fren%20balata", "/katalog?q=ya%C4%9F%20filtresi"]);
  assert.deepEqual(searchPaths(["fren balata"], "Mozilla/5.0"), []);
});

test("listing variants cover sorts, deep pages, stock and the filter links of the page, never a search", () => {
  const html = '<a href="/katalog?brand=BOSCH">b</a><a href="/katalog?brand=BOSCH">dup</a><a href="/katalog?q=x&amp;brand=A">s</a><a href="/other?brand=Z">o</a><a href="/katalog?attributes=a%3Db&amp;sort=newest">a</a>';
  const variants = listingVariants("/katalog", html, { pages: 3 });
  assert.deepEqual(variants.slice(0, 7), ["/katalog?sort=price-asc", "/katalog?sort=price-desc", "/katalog?sort=newest", "/katalog?page=2", "/katalog?page=3", "/katalog?availability=in_stock", "/katalog?availability=in_stock&sort=price-asc"]);
  assert.deepEqual(variants.slice(7), ["/katalog?brand=BOSCH", "/katalog?attributes=a%3Db&sort=newest"]);
  assert.ok(variants.every((url) => !/[?&]q=/.test(url)));
});

test("a path that already has a query gets no variants", () => {
  assert.deepEqual(listingVariants("/katalog?page=2"), []);
});

test("SIGUSR2 is sent only to a process whose armed line is in the log", () => {
  const log = "Memory limits: heapLimit=1MB\nMemory probe: armed pid=4242\nMemory: rss=1MB";
  assert.ok(probeArmed(log, 4242));
  assert.ok(probeArmed(log, "4242"));
  assert.ok(!probeArmed(log, 42), "another pid");
  assert.ok(!probeArmed("Memory: rss=1MB", 4242), "no line, no handler");
  assert.ok(!probeArmed("", 4242));
});

test("the harness crawler pattern and default agent match src/lib/crawler-user-agent.ts", () => {
  const source = readFileSync(new URL("../../src/lib/crawler-user-agent.ts", import.meta.url), "utf8");
  const match = source.match(/crawlerUserAgent = \/(.+)\/([a-z]*);/);
  assert.ok(match, "the TS module exports crawlerUserAgent as a regex literal");
  assert.equal(crawlerPattern.source, match[1]);
  assert.equal(crawlerPattern.flags, match[2]);
  assert.ok(new RegExp(match[1], match[2]).test(defaultUserAgent));
});
