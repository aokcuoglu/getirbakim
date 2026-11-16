import "server-only";
import {db} from "@/lib/db";
import {manufacturerBrandKey} from "./enrichment-contract";
import {getStaticManufacturerLogo} from "./storefront-logos";

export type ManufacturerLogo = {src: string; width: number; height: number};
/** Where a brand's logo comes from (#819): an admin's (brand_logos), data/brand-logos.json, enrichment (manufacturer_logos). */
export type BrandLogoSource = "manual" | "static" | "enrichment" | "hidden";
export type ResolvedBrandLogo = {
  logo: ManufacturerLogo | null;
  source: BrandLogoSource | null;
  /** An automatic (static or enrichment) logo exists, whether or not the admin's choice overrides it. */
  automatic: boolean;
};
export type EnrichmentLogo = {brand_key: string; sha256: string; width: number; height: number};
type ManualLogo = {sha256: string | null; width: number | null; height: number | null};
type Automatic = {logo: ManufacturerLogo; source: "static" | "enrichment"};

/**
 * The first candidate spelling with a logo: each tries data/brand-logos.json, then the enrichment logo of its brand key.
 * Candidates are the label itself, its master brand's name and the brand's other labels, so every spelling of one brand
 * shows the same logo.
 */
export function pickAutomaticLogo(candidates: string[], staticLookup: (name: string) => ManufacturerLogo | undefined,
  byKey: Map<string, EnrichmentLogo>): Automatic | null {
  for (const candidate of candidates) {
    const known = staticLookup(candidate);
    if (known) return {logo: known, source: "static"};
    const row = byKey.get(manufacturerBrandKey(candidate));
    if (row) return {logo: {src: `/api/manufacturer-logos/${row.brand_key}?v=${row.sha256}`, width: row.width, height: row.height}, source: "enrichment"};
  }
  return null;
}

/** An admin's logo wins; a hidden mark shows none; otherwise the automatic logo. */
function resolveOne(brandId: string | null, candidates: string[], manual: ManualLogo | undefined,
  byKey: Map<string, EnrichmentLogo>): ResolvedBrandLogo {
  const automatic = pickAutomaticLogo(candidates, getStaticManufacturerLogo, byKey);
  if (brandId && manual) {
    if (!manual.sha256 || !manual.width || !manual.height) return {logo: null, source: "hidden", automatic: Boolean(automatic)};
    return {logo: {src: `/api/brand-logos/${brandId}?v=${manual.sha256}`, width: manual.width, height: manual.height},
      source: "manual", automatic: Boolean(automatic)};
  }
  return automatic ? {logo: automatic.logo, source: automatic.source, automatic: true} : {logo: null, source: null, automatic: false};
}

const unique = (values: string[]) => [...new Set(values.filter(value => value.trim()))];

async function enrichmentLogos(candidates: string[]) {
  const keys = unique(candidates.filter(name => !getStaticManufacturerLogo(name)).map(manufacturerBrandKey));
  if (!keys.length) return new Map<string, EnrichmentLogo>();
  const rows = (await db.query<EnrichmentLogo>(
    "SELECT brand_key,sha256,width,height FROM manufacturer_logos WHERE brand_key=ANY($1::text[])", [keys])).rows;
  return new Map(rows.map(row => [row.brand_key, row]));
}

/**
 * Store logos of brand labels as products show them (a supplier's label, or the master brand name). Each label is
 * placed in its master brand (its name first, then the label with the most items), so the admin's logo and every
 * spelling's automatic logo apply; a label no master brand knows only tries its own spelling.
 */
export async function getManufacturerLogos(brands: string[]) {
  const logos = new Map<string,ManufacturerLogo>();
  const labels = unique(brands);
  if (!labels.length) return logos;
  const rows = (await db.query<{label: string; brand_id: string | null; names: string[] | null; manual: boolean;
    sha256: string | null; width: number | null; height: number | null}>(`
    SELECT l.label, b.id::text AS brand_id, n.names, bl.brand_id IS NOT NULL AS manual, bl.sha256, bl.width, bl.height
    FROM unnest($1::text[]) l(label)
    LEFT JOIN LATERAL (
     SELECT c.id FROM (
      SELECT b.id, true AS named, 0 AS items FROM brands b WHERE upper(trim(b.name))=upper(trim(l.label))
      UNION ALL
      SELECT sb.brand_id, false, sb.items FROM supplier_brands sb WHERE sb.label=l.label
     ) c ORDER BY c.named DESC, c.items DESC, c.id LIMIT 1
    ) b ON true
    LEFT JOIN LATERAL (
     SELECT array_agg(x.name ORDER BY x.ord, x.items DESC, x.name) AS names FROM (
      SELECT name, 0 AS ord, 0 AS items FROM brands WHERE id=b.id
      UNION ALL
      SELECT label, 1, max(items) FROM supplier_brands WHERE brand_id=b.id GROUP BY label
     ) x
    ) n ON true
    LEFT JOIN brand_logos bl ON bl.brand_id=b.id`, [labels])).rows;
  const candidates = new Map(rows.map(row => [row.label, unique([row.label, ...(row.names ?? [])])]));
  const byKey = await enrichmentLogos(rows.flatMap(row => row.manual ? [] : candidates.get(row.label) ?? []));
  const resolved = new Map(rows.map(row => [row.label,
    resolveOne(row.brand_id, candidates.get(row.label) ?? [row.label], row.manual ? row : undefined, byKey)]));
  for (const brand of brands) {
    const logo = resolved.get(brand)?.logo;
    if (logo) logos.set(brand,logo);
  }
  return logos;
}

/**
 * The admin panel's view of master brands' logos (same rule as the store). `labels` are the brand's supplier labels,
 * most items first.
 */
export async function resolveBrandLogos(brands: {id: string; name: string; labels: string[]}[]) {
  const resolved = new Map<string,ResolvedBrandLogo>();
  if (!brands.length) return resolved;
  const manual = new Map((await db.query<ManualLogo & {brand_id: string}>(
    "SELECT brand_id::text,sha256,width,height FROM brand_logos WHERE brand_id=ANY($1::bigint[])", [brands.map(brand => brand.id)])).rows
    .map(row => [row.brand_id, row]));
  const candidates = new Map(brands.map(brand => [brand.id, unique([brand.name, ...brand.labels])]));
  const byKey = await enrichmentLogos([...candidates.values()].flat());
  for (const brand of brands) resolved.set(brand.id, resolveOne(brand.id, candidates.get(brand.id) ?? [], manual.get(brand.id), byKey));
  return resolved;
}
