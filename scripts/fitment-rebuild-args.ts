import { z } from "zod";

// Pure helpers of scripts/rebuild-product-fitments.ts (kept apart so tests can import them without a database).

export type RebuildArgs = { itemsFile: string | null };

const usage = "Usage: rebuild-product-fitments.ts [--items=<json file of supplier item ids>]";

/** No arguments rebuild everything; --items=<file> rebuilds those items. Anything else is an error, never a full rebuild. */
export function parseRebuildArgs(argv: string[]): RebuildArgs {
  const parsed: RebuildArgs = { itemsFile: null };
  for (const arg of argv) {
    if (arg.startsWith("--items=") && parsed.itemsFile === null && arg.length > "--items=".length) parsed.itemsFile = arg.slice("--items=".length);
    else throw new Error(`Unknown or repeated argument: ${arg}. ${usage}`);
  }
  return parsed;
}

const itemsSchema = z.array(z.uuid());

/** The --items file: a JSON array of supplier item uuids (possibly empty). */
export function parseRebuildItems(text: string): string[] {
  const result = itemsSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error(`The --items file must be a JSON array of supplier item uuids: ${result.error.issues[0]?.message ?? "invalid"}`);
  return result.data;
}
