import { parseCatalogQuery } from "@/modules/store/catalog-query";
import { type SearchParams } from "@/lib/search-params";
import {getStoreCategories} from "@/modules/store/categories";
import {CatalogView,catalogDescription} from "./catalog-view";
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
 const params=parseCatalogQuery({...await searchParams,make:undefined});
 const categories=await getStoreCategories();
 const category=categories.find(c=>c.slug===params.category);
 return {title:`${category?.name ?? "Yedek parça kataloğu"} | Getirbakim`,description:(catalogDescription(category?.slug ?? "yedek-parca")??`${category?.name} ürünlerini incele. Ürün kodu ve OEM numarasıyla uyumluluğu kontrol et.`).slice(0,180),
  alternates:{canonical:category ? `/katalog?category=${category.slug}` : "/katalog"},
  robots:params.q || params.brand || params.brands || params.attributes || params.availability || params.sort || params.page ? {index:false,follow:true} : undefined};
}
export default async function Catalog({searchParams}:{searchParams:Promise<SearchParams>}) {
 return <CatalogView params={parseCatalogQuery({...await searchParams,make:undefined})}/>;
}
