import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { partArtKinds } from "../src/components/part-art";
import { renderPartArt } from "./render-part-art";

test("static part art files match the component (run render-part-art --write after changing it)", async () => {
  for (const kind of partArtKinds) assert.equal(await readFile(`public/media/part-art/${kind}.svg`, "utf8"), renderPartArt(kind) + "\n", kind);
});
