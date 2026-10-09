import type { CatalogQuery } from "@/modules/store/catalog-query";
import Link from "next/link";
import { Search,ChevronRight,ShieldCheck,Truck,CarFront } from "lucide-react";
import { browseProducts,catalogFacets } from "@/modules/store/catalog";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { GarageButton } from "@/components/garage/garage-button";
import { CatalogSidebar,CatalogResults } from "@/components/catalog-controls";
import { CatalogProduct } from "@/components/catalog-product";
import { getCatalogProductImages,getCatalogProductDetails } from "@/modules/store/product-enrichment";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,type VehicleBrand} from "@/modules/store/vehicle-catalog";
import "@/styles/catalog.css";
import {getStoreCategories} from "@/modules/store/categories";
import {categoryPath} from "@/modules/store/category-tree";
import {CatalogStickyFinder} from "@/components/catalog-sticky-finder";
import {CategoryCards} from "@/components/category-cards";
const descriptions:Record<string,string>={
 "fren-diskleri-269":"Ön ve arka fren disklerini BOSCH, FEBI ve diğer üreticilerden seçeneklerle incele. Dolu veya havalandırmalı diskleri, ölçülerini ve montaj konumlarını karşılaştırarak aracına uygun parçayı bul. Bazı araçlarda sağ ve sol tarafta farklı diskler kullanılır; seçim yaparken OEM numarasını ve araç uyumluluğunu kontrol et. Aynı aks üzerindeki diskleri birlikte değiştir ve balataların durumunu da kontrol et.",
 "yedek-parca":"Aracının bakım ve onarımı için yedek parçaları tek yerde keşfet. Motor, fren, filtre ve diğer parça gruplarında ürünleri üreticiye göre incele; doğru parçayı bulmak için ürün kodu veya OEM numarasıyla ara. Sipariş vermeden önce parçanın araç modeli, motor tipi ve üretim yılıyla uyumluluğunu kontrol et.",
 fren:"Fren diskleri, balatalar ve fren sistemi parçalarını keşfet. Aracına uygun parçayı seçerken OEM kodunu, montaj konumunu ve araç özelliklerini kontrol et. Fren diskleri ve balataların aynı aks üzerindeki değişiminde üreticinin bakım önerilerini dikkate al.",
 filtre:"Yağ, hava, yakıt ve polen filtrelerini incele. Aracının motoruna ve modeline uygun filtreyi üretici veya ürün koduyla bul; bakım öncesinde OEM numarası ve araç bilgileriyle uyumluluğunu doğrula.",
 yag:"Motor yağları ve bakım sıvılarını incele. Aracın için doğru ürünü seçerken viskozite, üretici onayı ve kullanım kılavuzundaki özellikleri kontrol et.",
 silecek:"Silecek ve cam temizleme ürünlerini keşfet. Aracına uygun uzunluk ve bağlantı tipini kontrol ederek doğru ürünü seç.",
 aksesuar:"Araç bakımı için aksesuar ve ekipmanları incele. İhtiyacına uygun ürünleri marka ve ürün koduyla kolayca bul."
};
export const catalogDescription=(slug:string)=>descriptions[slug];
// Shared by /katalog and /car-parts/{make}; `make` is the brand resolved from params.make.
export async function CatalogView({params,make}:{params:CatalogQuery;make?:VehicleBrand}) {
 const [result,facetData,account,vehicle,vehicleBrands]=await Promise.all([browseProducts(params),catalogFacets(params),currentAccount(),currentVehicle(),getVehicleBrands()]);
 const products=result.items;
 const [images,logos,details]=await Promise.all([getCatalogProductImages(products),getManufacturerLogos(products.map(product=>product.brand)),getCatalogProductDetails(products)]);
 const categories=await getStoreCategories();
 const category=categories.find(c=>c.slug===params.category);
 const isBrakeCategory=category?.path.includes(252);
 const popularOrder=["VOLKSWAGEN","AUDI","TOYOTA","BMW","OPEL","VOLVO","SKODA","RENAULT","MERCEDES-BENZ","PEUGEOT","FORD","KIA","HYUNDAI","SUBARU","MAZDA","CITROËN","NISSAN","LEXUS","HONDA","SEAT"];
 const popularMakes=popularOrder.flatMap(name=>vehicleBrands.filter(brand=>brand.name===name));
 const makeName=make&&(make.name==="VOLKSWAGEN"?"VW":make.name);
 const title=params.q ? `“${params.q.slice(0,120)}” için arama sonuçları` : make ? `${makeName} ${category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları"}` : category?.name ?? "Yedek parça ve bakım ürünleri";
 const home=make?`/car-parts/${params.make}`:"/katalog";
 const finder=(
     <div className="catalog-vehicle-search">
      <form action={home} className="catalog-code-search" role="search" aria-label="OEM numarasıyla parça ara">
       <label><span aria-hidden="true">OEM</span><input type="search" name="q" aria-label="Ürün kodu veya OEM numarası" placeholder="Ürün kodu veya OEM numarası" defaultValue={params.q} maxLength={120} required/></label>
       <input type="hidden" name="searchBy" value="code"/>{category&&<input type="hidden" name="category" value={category.slug}/>}
       <button type="submit" aria-label="OEM ile ara"><Search size={20} aria-hidden="true"/></button>
      </form>
      <span className="catalog-search-separator">veya</span><GarageButton vehicle={vehicle} variant="catalog"/>
     </div>
 );
 return (
  <div className="catalog-page">
   <section className={"catalog-hero"+(isBrakeCategory?" catalog-hero-brakes":"")}>
    <div className="catalog-hero-note"><Search size={18} aria-hidden="true"/><span>Ürün kodu ve OEM numarasıyla parça arama</span></div>
    <div className="shell"><h1>{title}</h1>
     {finder}
    </div>
   </section>
   <CatalogStickyFinder brakes={Boolean(isBrakeCategory)}>{finder}</CatalogStickyFinder>
   <section className="shell catalog-body">
    <nav className="breadcrumbs" aria-label="Sayfa yolu"><Link href="/">Ana sayfa</Link>{make&&<><ChevronRight size={13}/><Link href="/automakers">Araç markaları</Link><ChevronRight size={13}/>{category?<Link href={home}>{makeName}</Link>:<span aria-current="page">{makeName}</span>}</>}{!category&&!make&&<><ChevronRight size={13}/><span>Katalog</span></>}{category && categoryPath(categories,category.id).map((node,index,path)=><span key={node.id}><ChevronRight size={13}/>{index===path.length-1?<span aria-current="page">{node.name}</span>:<Link href={`${home}?category=${node.slug}`}>{node.name}</Link>}</span>)}</nav>
    {!params.q&&<div className="catalog-introduction"><h2>{make&&!category?`${makeName} araçlar için yedek parçaları keşfet`:category?.id===269?"Aracın için ön ve arka fren disklerini keşfet":category?category.name+" ürünlerini keşfet":"Aracına uygun yedek parçayı bul"}</h2><p>{make&&!category?`${makeName} modellerine uygun olarak listelenen parçaları kategori ve üreticiye göre incele. Siparişten önce ürün sayfasındaki araç uyumluluğunu, OEM numarasını ve motor bilgilerini kontrol et.`:descriptions[category?.slug??"yedek-parca"]??category?.name+" ürünlerini üretici, montaj konumu ve teknik özelliklerine göre incele. Ürün kodunu veya OEM numarasını kullanarak aradığın parçayı bul ve siparişten önce aracınla uyumunu kontrol et."}</p></div>}
    {!params.q&&!make&&<section className="catalog-popular-makes" aria-label="Popüler araç markaları"><h2>Popüler araç markaları</h2><ul>{popularMakes.map(make=><li key={make.id}><Link href={"/car-parts/"+vehicleBrandSlug(make.name)}>{make.name==="VOLKSWAGEN"?"VW":make.name}</Link></li>)}</ul></section>}
    <div className="listing-layout">
     <CatalogSidebar categories={[...categories]} brands={facetData.brands} facets={facetData.attributes} params={params}/>
     <div className="category-results-column">
    {!params.q&&!params.brand&&!params.brands&&!params.attributes&&!params.availability&&<CategoryCards categories={categories.filter(node=>category?node.parentId===category.id:node.parentId===null)} basePath={home}/>}
     <CatalogResults count={result.total} page={result.page} pages={result.pages} pageSize={result.pageSize} params={params} defaultView="list">
      {products.length ? products.map(product => <CatalogProduct key={product.id} product={product} details={details.get(product.id)} image={images.get(product.id)} logo={logos.get(product.brand)} account={account}/>) :
       <div className="listing-empty"><Search size={38}/><h2>{params.q || params.brand || params.brands || params.attributes || params.availability ? "Aramana uygun ürün bulunamadı." : "Bu kategorinin ürünleri hazırlanıyor."}</h2><p>{params.q || params.brand || params.brands || params.attributes || params.availability ? "Farklı bir ürün kodu deneyebilir veya filtreleri temizleyebilirsin." : "Ürünler eklendiğinde burada listelenecek. Diğer kategorileri inceleyebilirsin."}</p><Link className="button" href={home}>Tüm ürünlere göz at</Link></div>}
     </CatalogResults>
     </div>
    </div>
   </section>
   <section className="catalog-service-benefits"><div className="shell">
    <div><ShieldCheck size={36} strokeWidth={1.4}/><span><strong>Sipariş bilgilerin tek yerde</strong><p>Ürün, fiyat ve teslimat bilgilerini birlikte incele.</p></span></div>
    <div><Truck size={36} strokeWidth={1.4}/><span><strong>Teslimat ve iade bilgileri</strong><p>Sipariş öncesi teslimat ve iade koşullarını öğren.</p></span></div>
    <div><CarFront size={36} strokeWidth={1.4}/><span><strong>Parça uyumluluğunu kontrol et</strong><p>OEM numarasını ve araç bilgilerini karşılaştır.</p></span></div>
   </div></section>
   {category&&<section className="catalog-related"><div className="shell"><h2>İlgili kategoriler</h2><CategoryCards categories={categories.filter(node=>node.parentId===category.parentId&&node.id!==category.id).slice(0,8)} basePath={home}/></div></section>}
  </div>
 );
}
