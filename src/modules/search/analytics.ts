import "server-only";
// Callers check the admin session for reads and edits; the storefront records searches.
import { db } from "@/lib/db";
import { normalizeSearchText, normalizeSynonym, searchTooShort } from "./query";
import type { SearchMode } from "./sql";

const retentionDays = 180;

/** Counts one storefront search (first result page, #822). Never throws: a failed count must not break the page. */
export async function recordSearch(input: { query: string; mode: SearchMode; total: number; correctedQuery?: string | null }) {
  if (searchTooShort(input.query)) return;
  const query = normalizeSearchText(input.query.slice(0, 120)).slice(0, 120);
  const corrected = input.correctedQuery ? normalizeSearchText(input.correctedQuery).slice(0, 120) : null;
  try {
    await db.query(`INSERT INTO search_query_stats AS s (day,mode,query,searches,zero_results,last_total,corrected_query)
      VALUES (current_date,$1,$2,1,$3,$4,$5)
      ON CONFLICT (day,mode,query) DO UPDATE SET searches=s.searches+1,zero_results=s.zero_results+EXCLUDED.zero_results,
       last_total=EXCLUDED.last_total,corrected_query=EXCLUDED.corrected_query,last_searched_at=now()`,
      [input.mode, query, input.total === 0 ? 1 : 0, input.total, corrected]);
    // About one search in 200 trims old days; the primary key starts with the day.
    if (Math.random() < 0.005) await db.query("DELETE FROM search_query_stats WHERE day < current_date - $1::int", [retentionDays]);
  } catch (error) {
    console.error("Search stats: record failed", error instanceof Error ? error.message : error);
  }
}

export type SearchStatsTab = "zero" | "top";
export const searchStatsPeriods = [7, 30, 90] as const;
export type SearchStatsPeriod = (typeof searchStatsPeriods)[number];
export type SearchStatRow = {
  query: string; mode: SearchMode; searches: number; zero_results: number; last_total: number;
  corrected_query: string | null; last_searched_at: Date;
};
export const searchStatsLimit = 200;

/**
 * The most searched queries of the last `days` days. `zero`: only queries whose latest search still found nothing
 * (a query fixed meanwhile, by a synonym or new stock, drops out).
 */
export async function loadSearchStats(tab: SearchStatsTab, days: SearchStatsPeriod) {
  const { rows } = await db.query<SearchStatRow>(`
    SELECT query, mode, sum(searches)::int AS searches, sum(zero_results)::int AS zero_results,
      (array_agg(last_total ORDER BY last_searched_at DESC))[1] AS last_total,
      (array_agg(corrected_query ORDER BY last_searched_at DESC))[1] AS corrected_query,
      max(last_searched_at) AS last_searched_at
    FROM search_query_stats WHERE day > current_date - $1::int
    GROUP BY query, mode
    ${tab === "zero" ? "HAVING (array_agg(last_total ORDER BY last_searched_at DESC))[1] = 0" : ""}
    ORDER BY searches DESC, last_searched_at DESC LIMIT ${searchStatsLimit}`, [days]);
  return rows;
}

/** Totals of the period for the page header. */
export async function loadSearchTotals(days: SearchStatsPeriod) {
  const { rows } = await db.query<{ searches: number; zero_results: number; queries: number }>(`
    SELECT COALESCE(sum(searches),0)::int AS searches, COALESCE(sum(zero_results),0)::int AS zero_results,
      count(DISTINCT (mode, query))::int AS queries
    FROM search_query_stats WHERE day > current_date - $1::int`, [days]);
  return rows[0];
}

export type CustomSynonymGroup = { id: string; words: string[]; created_at: Date; created_by_name: string | null };
export async function loadCustomSynonyms() {
  return (await db.query<CustomSynonymGroup>(`SELECT s.id::text, s.words, s.created_at, a.name AS created_by_name
    FROM search_synonyms s LEFT JOIN accounts a ON a.id = s.created_by ORDER BY s.created_at DESC`)).rows;
}

/** "Soğutma sıvısı, antifriz" → ["sogutma sivisi", "antifriz"]: distinct normalized spellings, at most four words each. */
export function parseSynonymInput(value: string) {
  return [...new Set(value.split(/[,;\n]+/).map(normalizeSynonym).filter(word => word.length >= 2))].slice(0, 12);
}

export async function addCustomSynonymGroup(words: string[], accountId: string) {
  await db.query("INSERT INTO search_synonyms (words, created_by) VALUES ($1::text[], $2)", [words, accountId]);
}
export async function deleteCustomSynonymGroup(id: string) {
  return ((await db.query("DELETE FROM search_synonyms WHERE id = $1::bigint", [id])).rowCount ?? 0) > 0;
}
