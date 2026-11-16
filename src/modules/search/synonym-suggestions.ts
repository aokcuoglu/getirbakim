import "server-only";
// AI-suggested synonym groups (#834). The model only proposes; an admin approves each group on /yonetim/arama.
// Callers check the admin session (page, actions); the CLI (scripts/suggest-search-synonyms.ts) runs as the operator.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { invalidateListings } from "@/modules/store/listing-epoch";
import { ensureCustomSynonyms } from "./custom-synonyms";
import { normalizeSynonym, parseSearchQuery } from "./query";
import { binder, supplierItemMatch } from "./sql";

/**
 * The model behind the suggestions: Claude when ANTHROPIC_API_KEY is set, else OpenAI (OPENAI_API_KEY). Override the
 * model with SEARCH_SUGGESTION_MODEL.
 */
type Provider = "anthropic" | "openai";
const provider = (): Provider | null => process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null;
export const suggestionModel = () => process.env.SEARCH_SUGGESTION_MODEL || (provider() === "openai" ? "gpt-5-mini" : "claude-opus-5-5");
export const aiSuggestionsEnabled = () => provider() !== null;

/**
 * Queries that may be sent to the model. Only the normalized text of mode=all searches is stored; long digit runs
 * (phone, order or part numbers), addresses and long free text stay here.
 */
export function sendableQuery(query: string) {
  return query.length <= 60 && /[a-z]{3}/.test(query) && !/\d{6}/.test(query) && !query.includes("@");
}

export const groupKey = (words: string[]) => [...new Set(words.map(normalizeSynonym).filter(Boolean))].sort().join("|");

/** Whether the parser already reads `a` and `b` as the same word (a synonym group or a Turkish ending). */
export function alreadyEquivalent(a: string, b: string) {
  const spellings = (value: string) => new Set(parseSearchQuery(value).terms.flatMap(term => term.alternatives.map(x => x.value)));
  const left = spellings(a);
  return [...spellings(b)].some(value => left.has(value));
}

/** Products a spelling finds with the current parser. */
async function hits(spelling: string) {
  const values: unknown[] = [];
  const match = supplierItemMatch("s", parseSearchQuery(spelling), binder(values));
  return (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items s WHERE s.presence='present' AND ${match}`, values)).rows[0].n;
}

/** Words of the store catalog (search_vocabulary); a suggested spelling may only use these, plus numbers. */
async function catalogWords(words: string[]) {
  const { rows } = await db.query<{ word: string }>("SELECT word FROM search_vocabulary WHERE scope='product' AND word = ANY($1::text[])", [words]);
  return new Set(rows.map(row => row.word));
}
async function inCatalog(spelling: string) {
  const words = spelling.split(" ").filter(word => !/^\d+$/.test(word));
  const known = await catalogWords(words);
  return words.length > 0 && words.every(word => known.has(word));
}

/**
 * One structured-output call. Claude: Messages API through the SDK with a Zod output format (low effort: a short
 * classification). OpenAI: Chat Completions with a strict JSON schema. Both base URLs can point tests at a stub
 * (ANTHROPIC_BASE_URL, OPENAI_BASE_URL).
 */
async function askModel<T extends z.ZodType>(system: string, input: unknown, schema: T): Promise<z.infer<T>> {
  const content = JSON.stringify(input);
  if (provider() === "anthropic") {
    const client = new Anthropic({ timeout: 120_000 });
    const response = await client.messages.parse({
      model: suggestionModel(),
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") throw new Error(`Claude declined the request (${response.stop_details?.category ?? "no category"})`);
    if (response.stop_reason === "max_tokens") throw new Error("Claude hit max_tokens; send a smaller batch");
    if (!response.parsed_output) throw new Error("Claude returned no parsable output");
    return response.parsed_output as z.infer<T>;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set");
  const response = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: suggestionModel(),
      messages: [{ role: "system", content: system }, { role: "user", content }],
      response_format: { type: "json_schema", json_schema: { name: "synonyms", strict: true, schema: z.toJSONSchema(schema) } },
    }),
  });
  if (!response.ok) {
    // The error names the code ("expired_secret_key", "insufficient_quota"); it never contains the key.
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.json() as { choices: { message: { content: string | null; refusal?: string | null } }[] };
  const message = body.choices[0]?.message;
  if (!message?.content) throw new Error(`OpenAI returned no content${message?.refusal ? `: ${message.refusal}` : ""}`);
  return schema.parse(JSON.parse(message.content));
}

const zeroResultAnswer = z.strictObject({ results: z.array(z.strictObject({ query: z.string(), spellings: z.array(z.string()), reason: z.string() })) });
const pairAnswer = z.strictObject({ results: z.array(z.strictObject({ a: z.string(), b: z.string(), same: z.boolean(), reason: z.string() })) });

const shopContext = `You help the search of a Turkish online auto-parts shop (yedek parça). Texts are normalized: lower case,
Turkish letters folded to ASCII (ş→s, ı→i, ğ→g, ü→u, ö→o, ç→c). Be conservative: a wrong synonym makes the shop list wrong
parts, a missing one only misses a search. Never pair different parts, positions or sides (ön/arka, sağ/sol, iç/dış),
sizes, brands, or a part with the system it belongs to.`;

async function checked(keys: string[], retryDays: number | null) {
  const { rows } = await db.query<{ key: string }>(`SELECT key FROM search_suggestion_checks WHERE key = ANY($1::text[])
    ${retryDays === null ? "" : "AND checked_at > now() - make_interval(days => $2::int)"}`, retryDays === null ? [keys] : [keys, retryDays]);
  return new Set(rows.map(row => row.key));
}
async function markChecked(keys: string[]) {
  if (keys.length) await db.query(`INSERT INTO search_suggestion_checks (key) SELECT unnest($1::text[])
    ON CONFLICT (key) DO UPDATE SET checked_at = now()`, [keys]);
}
async function suggested(keys: string[]) {
  const { rows } = await db.query<{ group_key: string }>("SELECT group_key FROM search_synonym_suggestions WHERE group_key = ANY($1::text[])", [keys]);
  return new Set(rows.map(row => row.group_key));
}
type Suggestion = { words: string[]; source: "zero_result" | "vocabulary"; query: string | null; reason: string; hits: number };
async function store(suggestions: Suggestion[]) {
  let added = 0;
  for (const suggestion of suggestions) {
    const { rowCount } = await db.query(`INSERT INTO search_synonym_suggestions (group_key, words, source, query, reason, hits, model)
      VALUES ($1, $2::text[], $3, $4, $5, $6, $7) ON CONFLICT (group_key) DO NOTHING`,
    [groupKey(suggestion.words), suggestion.words, suggestion.source, suggestion.query, suggestion.reason.slice(0, 500), suggestion.hits, suggestionModel()]);
    added += rowCount ?? 0;
  }
  return added;
}

/**
 * Zero-result storefront searches of the last 30 days, most searched first: the model gets each query with the catalog
 * words spelled closest to its words, and may answer with catalog phrases that name the same part. A suggestion is kept
 * only when every word of it is a catalog word and it finds products.
 */
export async function suggestForZeroResults(limit = 40) {
  const { rows } = await db.query<{ query: string }>(`SELECT query FROM search_query_stats
    WHERE mode='all' AND day > current_date - 30 GROUP BY query
    HAVING (array_agg(last_total ORDER BY last_searched_at DESC))[1] = 0
    ORDER BY sum(searches) DESC, max(last_searched_at) DESC LIMIT 500`);
  const done = await checked(rows.map(row => `q:${row.query}`), 30);
  const queries = rows.map(row => row.query).filter(query => sendableQuery(query) && !done.has(`q:${query}`)).slice(0, limit);
  if (!queries.length) return { sent: 0, added: 0 };
  const { rows: hintRows } = await db.query<{ query: string; hints: string[] }>(`
    SELECT q.query, array_agg(DISTINCT c.word) AS hints FROM unnest($1::text[]) q(query)
    CROSS JOIN LATERAL unnest(string_to_array(q.query, ' ')) w(word)
    CROSS JOIN LATERAL (SELECT v.word FROM search_vocabulary v WHERE v.scope='product' AND length(w.word) >= 3
      AND v.word % w.word ORDER BY similarity(v.word, w.word) * ln(2 + v.frequency) DESC LIMIT 6) c
    GROUP BY q.query`, [queries]);
  const hints = new Map(hintRows.map(row => [row.query, row.hints]));
  const suggestions: Suggestion[] = [];
  for (let start = 0; start < queries.length; start += 20) {
    const batch = queries.slice(start, start + 20);
    const answer = await askModel(
      `${shopContext}
Each item is a shopper's search that found nothing, with words that occur in the shop's catalog and are spelled like
its words. For each query return the catalog spellings (1-4 words, each word from catalog_words, or a number) that a
shopper typing the query means: the same part under another name, or the query with a typo fixed. Return an empty
spellings list when the query is not an auto part, is a brand or product the catalog lacks, or you are unsure.`,
      { items: batch.map(query => ({ query, catalog_words: hints.get(query) ?? [] })) },
      zeroResultAnswer);
    for (const result of answer.results) {
      if (!batch.includes(result.query)) continue;
      const spellings: string[] = [];
      for (const raw of result.spellings.slice(0, 4)) {
        const spelling = normalizeSynonym(raw);
        if (!spelling || spelling === result.query || alreadyEquivalent(result.query, spelling) || !(await inCatalog(spelling))) continue;
        if (await hits(spelling) > 0) spellings.push(spelling);
      }
      if (!spellings.length) continue;
      suggestions.push({ words: [result.query, ...new Set(spellings)], source: "zero_result", query: result.query, reason: result.reason,
        hits: Math.max(...await Promise.all(spellings.map(hits))) });
    }
    await markChecked(batch.map(query => `q:${query}`));
  }
  const fresh = await suggested(suggestions.map(s => groupKey(s.words)));
  return { sent: queries.length, added: await store(suggestions.filter(s => !fresh.has(groupKey(s.words)))) };
}

/**
 * Catalog words spelled alike (trigram similarity ≥ 0.5, both in 20+ products) that the parser does not yet treat as
 * one word: "egsoz"/"egzoz" kind of variants. Works before any search is recorded; the model keeps only the pairs that
 * are the same term.
 */
export async function suggestForVocabulary(limit = 120) {
  const { rows } = await db.query<{ a: string; b: string; fa: number; fb: number }>(`
    SELECT a.word AS a, b.word AS b, a.frequency AS fa, b.frequency AS fb
    FROM search_vocabulary a JOIN search_vocabulary b ON b.scope = 'product' AND b.word % a.word AND a.word < b.word
    WHERE a.scope = 'product' AND a.frequency >= 20 AND b.frequency >= 20 AND length(a.word) >= 5 AND length(b.word) >= 5
      AND similarity(a.word, b.word) >= 0.5
    ORDER BY least(a.frequency, b.frequency) DESC LIMIT 3000`);
  const done = await checked(rows.map(row => `pair:${row.a}|${row.b}`), null);
  const pairs = rows.filter(row => !done.has(`pair:${row.a}|${row.b}`) && !alreadyEquivalent(row.a, row.b)).slice(0, limit);
  if (!pairs.length) return { sent: 0, added: 0 };
  const answer = await askModel(
    `${shopContext}
Each pair holds two words of the shop's catalog that are spelled alike. Mark same=true only when both are spellings of
the same term (a misspelling, a regional or phonetic spelling, a loanword spelling), never when they differ in meaning,
even slightly (different part, side, position, material, size or grammatical sense).`,
    { pairs: pairs.map(({ a, b }) => ({ a, b })) },
    pairAnswer);
  const sent = new Map(pairs.map(pair => [`${pair.a}|${pair.b}`, pair]));
  const suggestions: Suggestion[] = [];
  for (const result of answer.results) {
    const pair = sent.get(`${result.a}|${result.b}`);
    if (!pair || !result.same) continue;
    // The rarer spelling is what a shopper misses: the gain is the products the other spelling holds.
    const [rare, common] = pair.fa <= pair.fb ? [pair.a, pair.b] : [pair.b, pair.a];
    suggestions.push({ words: [rare, common], source: "vocabulary", query: null, reason: result.reason, hits: Math.max(pair.fa, pair.fb) });
  }
  await markChecked(pairs.map(pair => `pair:${pair.a}|${pair.b}`));
  const fresh = await suggested(suggestions.map(s => groupKey(s.words)));
  return { sent: pairs.length, added: await store(suggestions.filter(s => !fresh.has(groupKey(s.words)))) };
}

export type SynonymSuggestion = {
  id: string; words: string[]; source: "zero_result" | "vocabulary"; query: string | null; reason: string; hits: number;
  model: string; created_at: Date;
};
export const suggestionListLimit = 200;
export async function loadPendingSuggestions() {
  return (await db.query<SynonymSuggestion>(`SELECT id::text, words, source, query, reason, hits, model, created_at
    FROM search_synonym_suggestions WHERE status='pending' ORDER BY hits DESC, created_at DESC LIMIT ${suggestionListLimit}`)).rows;
}
export async function pendingSuggestionCount() {
  return (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM search_synonym_suggestions WHERE status='pending'")).rows[0].n;
}

/** Approves a pending suggestion into search_synonyms (one transaction), or rejects it. False when it was not pending. */
export async function decideSuggestion(id: string, approve: boolean, accountId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ words: string[] }>(`UPDATE search_synonym_suggestions SET status=$2, decided_at=now(), decided_by=$3
      WHERE id=$1::bigint AND status='pending' RETURNING words`, [id, approve ? "approved" : "rejected", accountId]);
    if (rows[0] && approve) await client.query("INSERT INTO search_synonyms (words, created_by) VALUES ($1::text[], $2)", [rows[0].words, accountId]);
    await client.query("COMMIT");
    if (rows[0] && approve) { await invalidateListings(); await ensureCustomSynonyms(); }
    return Boolean(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally {
    client.release();
  }
}
