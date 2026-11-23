import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";

// The enrichments of a full storefront export (export-storefront-bundle.ts → split-storefront-bundle.ts, #1316) travel as
// newline-delimited JSON, one JSON.stringify(row) per line, so no step holds them as one string: V8 caps a string at
// ~512 MiB and a large delta passed that. Lines are cut on the 0x0A byte rather than with node:readline, which also ends
// a line at U+2028/U+2029: JSON.stringify leaves those unescaped inside strings, while it always escapes \n and \r.
export const ENRICHMENTS_FILE = "enrichments.ndjson";

/** Appends one JSON line per row; write() resolves to the line's byte length once the stream can take more. */
export function ndjsonWriter(path: string) {
  const stream = createWriteStream(path);
  return {
    async write(row: unknown) {
      const line = `${JSON.stringify(row)}\n`;
      if (!stream.write(line)) await once(stream, "drain");
      return Buffer.byteLength(line);
    },
    async close() {
      stream.end();
      await finished(stream);
    },
  };
}

/** Every row of an NDJSON file in order, with its line's byte length (newline included). */
export async function* readNdjson(path: string): AsyncGenerator<{ row: Record<string, unknown>; bytes: number }> {
  let pending: Buffer[] = [];
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    let start = 0;
    for (let end = chunk.indexOf(0x0a); end !== -1; end = chunk.indexOf(0x0a, start)) {
      pending.push(chunk.subarray(start, end));
      const line = pending.length === 1 ? pending[0] : Buffer.concat(pending);
      pending = [];
      start = end + 1;
      yield { row: JSON.parse(line.toString("utf8")) as Record<string, unknown>, bytes: line.length + 1 };
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  }
  // The writer ends every line with a newline: anything after the last one is a cut-off write.
  if (pending.length) throw new Error(`Truncated enrichments file: ${path} does not end with a newline`);
}
