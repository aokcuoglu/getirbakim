import { type SearchParams } from "@/lib/search-params";
import { CatalogView } from "./catalog-view";
import { listingMetadata, loadListing } from "./listing-route";

// All products and search. A category or a make has its own path (/kategori, /yedek-parca); the old
// ?category= form is sent there by src/proxy.ts.
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
 return listingMetadata(await loadListing({ search: await searchParams }));
}
export default async function Catalog({ searchParams }: { searchParams: Promise<SearchParams> }) {
 const { query } = await loadListing({ search: await searchParams });
 return <CatalogView params={query}/>;
}
