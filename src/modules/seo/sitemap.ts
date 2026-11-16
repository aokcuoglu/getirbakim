import { legalDocument, legalLinks } from "@/content/legal";
import { catalogPath, makesPath } from "./paths";

// The sitemap is an index (/sitemap.xml) of fixed files (/sitemaps/<file>, #634). Products are split by the first
// byte of their id: ids are random uuids (gen_random_uuid), so every file holds about the same share without a count.
// 64 files keep each well under the 50,000-URL limit (~12,000 URLs today; 45,000 is reached at ~2.9M products).
export const sitemapUrlLimit = 45_000;
export const productChunks = 64;

const bytesPerChunk = 256 / productChunks;
const hexByte = (value: number) => value.toString(16).padStart(2, "0");

/** Inclusive uuid range of product file `index` (0 … productChunks-1). */
export function productChunkRange(index: number) {
  const first = hexByte(index * bytesPerChunk), last = hexByte(index * bytesPerChunk + bytesPerChunk - 1);
  return { from: `${first}000000-0000-0000-0000-000000000000`, to: `${last}ffffff-ffff-ffff-ffff-ffffffffffff` };
}

const productFile = (index: number) => `products-${String(index).padStart(2, "0")}.xml`;

export function sitemapFiles() {
  return ["pages.xml", "categories.xml", "makes.xml", "manufacturers.xml", "models.xml", "model-categories.xml", ...Array.from({ length: productChunks }, (_, index) => productFile(index))];
}

export type SitemapFile = { kind: "pages" | "categories" | "makes" | "manufacturers" | "models" | "modelCategories" } | { kind: "products"; index: number };

export function parseSitemapFile(file: string): SitemapFile | null {
  if (file === "pages.xml") return { kind: "pages" };
  if (file === "categories.xml") return { kind: "categories" };
  if (file === "makes.xml") return { kind: "makes" };
  if (file === "manufacturers.xml") return { kind: "manufacturers" };
  // Vehicle model pages and model × category pages with enough products to be indexed (#673).
  if (file === "models.xml") return { kind: "models" };
  if (file === "model-categories.xml") return { kind: "modelCategories" };
  const match = /^products-(\d{2})\.xml$/.exec(file);
  const index = match ? Number(match[1]) : -1;
  return index >= 0 && index < productChunks ? { kind: "products", index } : null;
}

/** Staging is never indexed (robots.txt disallows it too); its sitemap files stay empty. */
export const sitemapEnabled = () => process.env.APP_ENV !== "staging";

/** The categories holding products (`direct`) and every ancestor of those, in the order of `nodes`. */
export function withAncestors<T extends { id: number; path: number[] }>(nodes: T[], direct: Iterable<number>): T[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const listed = new Set<number>();
  for (const id of direct) for (const ancestor of byId.get(id)?.path ?? []) listed.add(ancestor);
  return nodes.filter(node => listed.has(node.id));
}

export type SitemapEntry = { url: string; lastModified?: string };

const escapeXml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

export function renderUrlset(entries: SitemapEntry[]) {
  if (entries.length > sitemapUrlLimit) console.error(`Sitemap file holds ${entries.length} URLs; only the first ${sitemapUrlLimit} are listed.`);
  const urls = entries.slice(0, sitemapUrlLimit).map(entry =>
    `<url><loc>${escapeXml(entry.url)}</loc>${entry.lastModified ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function renderSitemapIndex(urls: string[]) {
  const files = urls.map(url => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.join("\n")}\n</sitemapindex>\n`;
}

/** Fixed store pages; legal pages carry the date their text last changed. */
export const staticPaths: { path: string; lastModified?: string }[] = [
  ...["", catalogPath, "/bakim-robotu", makesPath, "/servisler", "/bilgi/hakkimizda", "/bilgi/uyumluluk", "/bilgi/yardim"].map(path => ({ path })),
  ...legalLinks.map(page => ({ path: `/${page.slug}`, lastModified: legalDocument(page.slug)?.updatedAt })),
];

export const xmlHeaders = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" };
