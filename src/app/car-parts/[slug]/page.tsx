import {notFound} from "next/navigation";
import {parseCatalogQuery} from "@/modules/store/catalog-query";
import {type SearchParams} from "@/lib/search-params";
import {getStoreCategories} from "@/modules/store/categories";
import {getVehicleBrandBySlug} from "@/modules/store/vehicle-catalog.server";
import {CatalogView} from "../../katalog/catalog-view";

type Props={params:Promise<{slug:string}>;searchParams:Promise<SearchParams>};

async function load({params,searchParams}:Props) {
 const [{slug},search]=await Promise.all([params,searchParams]);
 const query=parseCatalogQuery({...search,make:slug});
 const make=query.make===slug?await getVehicleBrandBySlug(slug):undefined;
 if(!make)notFound();
 return {query,make};
}

export async function generateMetadata(props:Props) {
 const {query,make}=await load(props);
 const category=(await getStoreCategories()).find(c=>c.slug===query.category);
 const name=make.name==="VOLKSWAGEN"?"VW":make.name;
 const path=`/car-parts/${query.make}`;
 return {title:`${name} ${category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları"} | Getirbakim`,
  description:`${name} araçlara uygun ${category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları"} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`.slice(0,180),
  alternates:{canonical:category?`${path}?category=${category.slug}`:path},
  robots:query.q || query.brand || query.brands || query.attributes || query.availability || query.sort || query.page ? {index:false,follow:true} : undefined};
}

export default async function CarParts(props:Props) {
 const {query,make}=await load(props);
 return <CatalogView params={query} make={make}/>;
}
