import { parseCatalogQuery } from "@/modules/store/catalog-query";
import { type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import { Search,ChevronRight } from "lucide-react";
import { categories,browseProducts,catalogBrands } from "@/modules/store/catalog";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { GarageButton } from "@/components/garage/garage-button";
import { CatalogSidebar,CatalogResults } from "@/components/catalog-controls";
import { CatalogProduct } from "@/components/catalog-product";
import { getCatalogProductImages } from "@/modules/store/product-enrichment";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import { SearchBox } from "@/components/navigation/search-box";
import "@/styles/catalog.css";
const descriptions:Record<string,string>={
 "yedek-parca":"Aracının bakım ve onarımı için yedek parçaları tek yerde keşfet. Motor, fren, filtre ve diğer parça gruplarında ürünleri üreticiye göre incele; doğru parçayı bulmak için ürün kodu veya OEM numarasıyla ara. Sipariş vermeden önce parçanın araç modeli, motor tipi ve üretim yılıyla uyumluluğunu kontrol et.",
 fren:"Fren diskleri, balatalar ve fren sistemi parçalarını keşfet. Aracına uygun parçayı seçerken OEM kodunu, montaj konumunu ve araç özelliklerini kontrol et. Fren diskleri ve balataların aynı aks üzerindeki değişiminde üreticinin bakım önerilerini dikkate al.",
 filtre:"Yağ, hava, yakıt ve polen filtrelerini incele. Aracının motoruna ve modeline uygun filtreyi üretici veya ürün koduyla bul; bakım öncesinde OEM numarası ve araç bilgileriyle uyumluluğunu doğrula.",
 yag:"Motor yağları ve bakım sıvılarını incele. Aracın için doğru ürünü seçerken viskozite, üretici onayı ve kullanım kılavuzundaki özellikleri kontrol et.",
 silecek:"Silecek ve cam temizleme ürünlerini keşfet. Aracına uygun uzunluk ve bağlantı tipini kontrol ederek doğru ürünü seç.",
 aksesuar:"Araç bakımı için aksesuar ve ekipmanları incele. İhtiyacına uygun ürünleri marka ve ürün koduyla kolayca bul."
};
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
 const params=parseCatalogQuery(await searchParams);
 const category=categories.find(c=>c.slug===params.category);
 return {title:`${category?.name ?? "Yedek parça kataloğu"} | Getirbakim`,description:descriptions[category?.slug ?? "yedek-parca"].slice(0,180),
  alternates:{canonical:category ? `/katalog?category=${category.slug}` : "/katalog"},
  robots:params.q || params.brand || params.sort || params.page ? {index:false,follow:true} : undefined};
}
export default async function Catalog({searchParams}:{searchParams:Promise<SearchParams>}) {
 const params=parseCatalogQuery(await searchParams);
 const [result,brands,account,vehicle]=await Promise.all([browseProducts(params),catalogBrands(),currentAccount(),currentVehicle()]);
 const products=result.items;
 const [images,logos]=await Promise.all([getCatalogProductImages(products),getManufacturerLogos(products.map(product=>product.brand))]);
 const category=categories.find(c=>c.slug===params.category);
 const title=params.q ? `“${params.q.slice(0,120)}” için arama sonuçları` : category?.name ?? "Yedek parça ve bakım ürünleri";
 return (
  <div className="catalog-page">
   <section className="catalog-hero"><div className="shell">
    <p className="catalog-hero-kicker">YEDEK PARÇA KATALOĞU</p>
    <h1>{title}</h1>
    <p className="catalog-description">{params.q ? "Ürün kodunu, OEM numarasını ve teknik özellikleri karşılaştır." : descriptions[category?.slug ?? "yedek-parca"]}</p>
    <div className="catalog-vehicle-search">
     <SearchBox key={`${params.q ?? ""}-${params.searchBy ?? "all"}-${category?.slug ?? ""}`} variant="catalog" defaultQuery={params.q} defaultMode={params.searchBy === "code" ? "code" : "all"} category={category?.slug} />
     <GarageButton vehicle={vehicle} variant="catalog" />
    </div>
   </div></section>
   <section className="shell catalog-body">
    <nav className="breadcrumbs" aria-label="Sayfa yolu"><Link href="/">Ana sayfa</Link><ChevronRight size={13}/><Link href="/katalog">Katalog</Link>{category && <><ChevronRight size={13}/><span aria-current="page">{category.name}</span></>}</nav>
    <div className="listing-layout">
     <CatalogSidebar categories={[...categories]} brands={brands} params={params}/>
     <CatalogResults count={result.total} page={result.page} pages={result.pages} pageSize={result.pageSize} params={params} defaultView={account?.role === "service" ? "list" : "grid"}>
      {products.length ? products.map(product => <CatalogProduct key={product.id} product={product} image={images.get(product.id)} logo={logos.get(product.brand)} account={account}/>) :
       <div className="listing-empty"><Search size={38}/><h2>{params.q || params.brand ? "Aramana uygun ürün bulunamadı." : "Bu kategorinin ürünleri hazırlanıyor."}</h2><p>{params.q || params.brand ? "Farklı bir ürün kodu deneyebilir veya filtreleri temizleyebilirsin." : "Ürünler eklendiğinde burada listelenecek. Diğer kategorileri inceleyebilirsin."}</p><Link className="button" href="/katalog">Tüm ürünlere göz at</Link></div>}
     </CatalogResults>
    </div>
   </section>
  </div>
 );
}
