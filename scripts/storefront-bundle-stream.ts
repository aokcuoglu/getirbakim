import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";

// The rows of a full storefront export that grow with the enriched products (export-storefront-bundle.ts →
// split-storefront-bundle.ts) travel as newline-delimited JSON, one JSON.stringify(row) per line, so no step holds them
// as one string: V8 caps a string at ~512 MiB. The enrichments moved first (#1316: a large delta passed the cap); the
// enrichment job statuses, supplier item keys, category mappings and media rows followed (#1317), because every run
// carries all job statuses and their keys. Lines are cut on the 0x0A byte rather than with node:readline, which also ends
// a line at U+2028/U+2029: JSON.stringify leaves those unescaped inside strings, while it always escapes \n and \r.
export const ENRICHMENTS_FILE = "enrichments.ndjson";
export const JOBS_FILE = "jobs.ndjson";
export const ITEMS_FILE = "items.ndjson";
export const PRODUCTS_FILE = "products.ndjson";
export const MEDIA_FILE = "media.ndjson";

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

/** Writes every row as one line of a new NDJSON file; resolves to the number of rows written. */
export async function writeNdjson(path: string, rows: Iterable<unknown>) {
  const writer = ndjsonWriter(path);
  let count = 0;
  for (const row of rows) {
    await writer.write(row);
    count++;
  }
  await writer.close();
  return count;
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
  if (pending.length) throw new Error(`Truncated NDJSON file: ${path} does not end with a newline`);
}

/** Every row of an NDJSON file as one array (separate rows, never one string). */
export async function readNdjsonRows<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for await (const { row } of readNdjson(path)) rows.push(row as T);
  return rows;
}
