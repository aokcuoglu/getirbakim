import {type SearchParams} from "@/lib/search-params";
import {CatalogView} from "../../../../katalog/catalog-view";
import {listingMetadata,loadListing} from "../../../../katalog/listing-route";

type Props={params:Promise<{category:string;make:string;model:string}>;searchParams:Promise<SearchParams>};

async function load({params,searchParams}:Props) {
 const [{category,make,model},search]=await Promise.all([params,searchParams]);
 return loadListing({category,make,model,search});
}

export async function generateMetadata(props:Props) {
 return listingMetadata(await load(props));
}

// A vehicle model's parts in one category (#673): the model page narrowed to a category and its subcategories.
export default async function ModelCategoryParts(props:Props) {
 const {query,make,model,plainTotal}=await load(props);
 return <CatalogView params={query} make={make} model={model} plainTotal={plainTotal}/>;
}
