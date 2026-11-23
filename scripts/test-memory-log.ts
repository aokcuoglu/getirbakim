import test from "node:test";
import assert from "node:assert/strict";
import { formatMemoryLine, startMemoryLog } from "../src/lib/memory-log";

const usage = { rss: 512 * 1048576, heapTotal: 200 * 1048576, heapUsed: 150 * 1048576, external: 20 * 1048576, arrayBuffers: 5 * 1048576 };

test("formatMemoryLine prints one line with megabytes and cache stats", () => {
  const line = formatMemoryLine(usage, { entries: 12, weight: 3456 });
  assert.equal(line, "Memory: rss=512MB heapUsed=150MB heapTotal=200MB external=20MB arrayBuffers=5MB caches=12/3456");
});

test("startMemoryLog logs the limits once and then the line every interval", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const lines: string[] = [];
  const stop = startMemoryLog({ intervalMs: 1000, log: line => lines.push(line) });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Memory limits: heapLimit=\d+MB total=\d+MB constrained=/);
  context.mock.timers.tick(3000);
  assert.equal(lines.length, 4);
  assert.match(lines[3], /^Memory: rss=\d+MB .* caches=\d+\/\d+$/);
  stop();
  context.mock.timers.tick(3000);
  assert.equal(lines.length, 4);
});

test("an interval of 0 or less disables the log", () => {
  const lines: string[] = [];
  startMemoryLog({ intervalMs: 0, log: line => lines.push(line) })();
  startMemoryLog({ intervalMs: -5, log: line => lines.push(line) })();
  assert.deepEqual(lines, []);
});
