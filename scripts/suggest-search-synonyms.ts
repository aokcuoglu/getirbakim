// AI synonym suggestions for /yonetim/arama (#834): `npm run search:suggest -- [--source zero|vocabulary|all] [--limit N]`.
// Suggestions wait in search_synonym_suggestions for an admin's decision; nothing reaches search unapproved.
import { db } from "../src/lib/db";
import { aiSuggestionsEnabled, suggestForVocabulary, suggestForZeroResults, suggestionModel } from "../src/modules/search/synonym-suggestions";

const arg = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : undefined; };
const source = arg("source") ?? "all";
const limit = arg("limit") ? Number(arg("limit")) : undefined;
if (!["zero", "vocabulary", "all"].includes(source) || (limit !== undefined && !(limit > 0))) {
  console.error("Usage: search:suggest [--source zero|vocabulary|all] [--limit N]"); process.exit(2);
}
if (!aiSuggestionsEnabled()) { console.error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY"); process.exit(2); }
try {
  console.log(`Model: ${suggestionModel()}`);
  if (source !== "vocabulary") console.log("Zero-result queries:", await suggestForZeroResults(limit));
  if (source !== "zero") console.log("Catalog spelling pairs:", await suggestForVocabulary(limit));
} finally {
  await db.end();
}
