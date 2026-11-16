import {type SearchParams} from "@/lib/search-params";
import {CatalogView} from "../../../katalog/catalog-view";
import {listingMetadata,loadListing} from "../../../katalog/listing-route";

type Props={params:Promise<{category:string;make:string}>;searchParams:Promise<SearchParams>};

async function load({params,searchParams}:Props) {
 const [{category,make},search]=await Promise.all([params,searchParams]);
 return loadListing({category,make,search});
}

export async function generateMetadata(props:Props) {
 return listingMetadata(await load(props));
}

export default async function MakeCategoryParts(props:Props) {
 const {query,make,plainTotal}=await load(props);
 return <CatalogView params={query} make={make} plainTotal={plainTotal}/>;
}
