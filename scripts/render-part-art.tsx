// Writes public/media/part-art/<kind>.svg from <PartArt/>: product cards load one cached file instead
// of repeating ~4 kB of inline SVG per card. Re-run after changing part-art.tsx (test:part-art checks).
import { writeFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { PartArt, partArtKinds } from "../src/components/part-art";

export const renderPartArt = (kind: string) =>
  renderToStaticMarkup(<PartArt kind={kind} />).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');

if (process.argv.includes("--write")) {
  for (const kind of partArtKinds) await writeFile(`public/media/part-art/${kind}.svg`, renderPartArt(kind) + "\n");
  console.log(`Part art written: ${partArtKinds.join(", ")}`);
}
