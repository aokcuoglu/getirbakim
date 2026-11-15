import {type SearchParams} from "@/lib/search-params";
import {CatalogView} from "../../katalog/catalog-view";
import {listingMetadata,loadListing} from "../../katalog/listing-route";

type Props={params:Promise<{make:string}>;searchParams:Promise<SearchParams>};

async function load({params,searchParams}:Props) {
 const [{make},search]=await Promise.all([params,searchParams]);
 return loadListing({make,search});
}

export async function generateMetadata(props:Props) {
 return listingMetadata(await load(props));
}

export default async function MakeParts(props:Props) {
 const {query,make}=await load(props);
 return <CatalogView params={query} make={make}/>;
}
