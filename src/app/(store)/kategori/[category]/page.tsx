import {type SearchParams} from "@/lib/search-params";
import {CatalogView} from "../../katalog/catalog-view";
import {listingMetadata,loadListing} from "../../katalog/listing-route";

type Props={params:Promise<{category:string}>;searchParams:Promise<SearchParams>};

async function load({params,searchParams}:Props) {
 const [{category},search]=await Promise.all([params,searchParams]);
 return loadListing({category,search});
}

export async function generateMetadata(props:Props) {
 return listingMetadata(await load(props));
}

export default async function CategoryParts(props:Props) {
 const {query}=await load(props);
 return <CatalogView params={query}/>;
}
