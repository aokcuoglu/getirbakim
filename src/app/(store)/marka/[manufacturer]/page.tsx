import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import type { SearchParams } from "@/lib/search-params";
import { pageMetadata } from "@/lib/site";
import { manufacturerPath, slugPattern } from "@/modules/seo/paths";
import { listingTotal } from "@/modules/store/catalog";
import { parseCatalogQuery, type CatalogQuery } from "@/modules/store/catalog-query";
import { manufacturerIndexable, manufacturerTexts } from "@/modules/store/manufacturers";
import { brandedTitle } from "@/modules/seo/meta-text";
import { findManufacturer } from "@/modules/store/manufacturers.server";
import { CatalogView } from "../../katalog/catalog-view";

type Props = { params: Promise<{ manufacturer: string }>; searchParams: Promise<SearchParams> };

/**
 * The page's manufacturer, its listing query and its product count without filters. An unknown slug or a manufacturer
 * without a listed product is a 404; a label's own slug (blue-print) moves to its master brand's page (308).
 */
const load = cache(async (slug: string, search: SearchParams) => {
  const match = slugPattern.test(slug) ? await findManufacturer(slug) : null;
  if (!match) notFound();
  if (match.kind === "alias") {
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) for (const entry of [value ?? []].flat()) rest.append(key, entry);
    permanentRedirect(rest.size ? `${manufacturerPath(match.slug)}?${rest}` : manufacturerPath(match.slug));
  }
  // Category, make and model are other listings' path segments; a query one is ignored here.
  const query: CatalogQuery = { ...parseCatalogQuery({ ...search, category: undefined, make: undefined, model: undefined }), manufacturer: slug };
  const total = await listingTotal({ manufacturer: slug });
  if (!total) notFound();
  return { manufacturer: match.manufacturer, query, total };
});

async function loadPage({ params, searchParams }: Props) {
  const [{ manufacturer }, search] = await Promise.all([params, searchParams]);
  return load(manufacturer, search);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { manufacturer, query, total } = await loadPage(props);
  const { title, description } = manufacturerTexts(manufacturer.name, total);
  return pageMetadata({ ...brandedTitle(title), description, path: manufacturerPath(manufacturer.slug),
    robots: manufacturerIndexable(manufacturer.slug, query, total) ? undefined : { index: false, follow: true } });
}

// A manufacturer's (master brand's) products under every supplier label (#660).
export default async function ManufacturerParts(props: Props) {
  const { manufacturer, query, total } = await loadPage(props);
  return <CatalogView params={query} manufacturer={{ name: manufacturer.name, slug: manufacturer.slug }} manufacturerTotal={total}/>;
}
