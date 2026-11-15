import {type SearchParams} from "@/lib/search-params";
import {CatalogView} from "../../../katalog/catalog-view";
import {listingMetadata,loadListing} from "../../../katalog/listing-route";

type Props={params:Promise<{make:string;model:string}>;searchParams:Promise<SearchParams>};

async function load({params,searchParams}:Props) {
 const [{make,model},search]=await Promise.all([params,searchParams]);
 return loadListing({make,model,search});
}

export async function generateMetadata(props:Props) {
 return listingMetadata(await load(props));
}

// A vehicle model's parts (#639): the make page's listing narrowed to one model family and generation.
export default async function ModelParts(props:Props) {
 const {query,make,model,modelTotal}=await load(props);
 return <CatalogView params={query} make={make} model={model} modelTotal={modelTotal}/>;
}
