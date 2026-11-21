import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = (...args) => spawnSync("node", ["scripts/harness/measure-store.mjs", ...args], { encoding: "utf8", timeout: 20_000 });

test("measure-store refuses bad input with exit 2 before starting anything", () => {
  for (const args of [["--port", "3000"], ["--base", "http://localhost:3000/"], ["--base", "not a url"], ["/katalog?q=filtre"], ["/katalog?page=2&q=filtre"], ["--bogus"]]) {
    const result = run(...args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
  }
});
