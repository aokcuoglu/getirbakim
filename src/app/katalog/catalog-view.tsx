import type { CatalogQuery } from "@/modules/store/catalog-query";
import { Fragment } from "react";
import Link from "next/link";
import { minSearchLength } from "@/modules/search/query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Breadcrumb,BreadcrumbItem,BreadcrumbLink,BreadcrumbList,BreadcrumbPage,BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Search,ChevronRight,ShieldCheck,Truck,CarFront,CircleCheck } from "lucide-react";
import { browseProducts,catalogFacets,vehicleFitCount,productsFittingVehicle } from "@/modules/store/catalog";
import { fitmentVehicle } from "@/modules/store/fitment-level.server";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { GarageButton } from "@/components/garage/garage-button";
import { CatalogSidebar,CatalogResults } from "@/components/catalog-controls";
import { CatalogProduct } from "@/components/catalog-product";
import { getCatalogProductImages,getCatalogProductDetails } from "@/modules/store/product-enrichment";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,type VehicleBrand} from "@/modules/store/vehicle-catalog";
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
const benefits=[
 {icon:ShieldCheck,title:"Sipariş bilgilerin tek yerde",text:"Ürün, fiyat ve teslimat bilgilerini birlikte incele."},
 {icon:Truck,title:"Teslimat ve iade bilgileri",text:"Sipariş öncesi teslimat ve iade koşullarını öğren."},
 {icon:CarFront,title:"Parça uyumluluğunu kontrol et",text:"OEM numarasını ve araç bilgilerini karşılaştır."},
];
// OEM code search plus the garage picker; `compact` is the smaller copy inside the sticky finder.
function CatalogFinder({compact,home,query,category,vehicle}:{compact:boolean;home:string;query?:string;category?:string;vehicle:Awaited<ReturnType<typeof currentVehicle>>}){
 return <div className={cn("flex items-center justify-center py-1 max-[600px]:mx-auto max-[600px]:max-w-[400px] max-[600px]:flex-wrap",compact&&"h-20 px-[15px] py-4")}>
  <form action={home} className="flex gap-2.5 max-[600px]:w-full" role="search" aria-label="OEM numarasıyla parça ara">
   <label className={cn("flex h-14 w-[296px] overflow-hidden rounded-md border border-white bg-white min-[601px]:max-[850px]:w-60 max-[600px]:w-auto max-[600px]:min-w-0 max-[600px]:flex-1",compact&&"h-12 w-[245px]")}>
    <span aria-hidden="true" className="flex flex-[0_0_36px] items-center justify-center bg-[#003399] text-[11px] font-semibold text-white">OEM</span>
    <input type="search" name="q" aria-label="Ürün kodu veya OEM numarası" placeholder="Ürün kodu veya OEM numarası" defaultValue={query} minLength={2} maxLength={120} required
     className={cn("h-[54px] w-full min-w-0 border-0 bg-white px-2.5 py-3.5 text-sm text-[#54626e] outline-none placeholder:text-[#637381]",compact&&"h-[46px]")}/>
   </label>
   <input type="hidden" name="searchBy" value="code"/>{category&&<input type="hidden" name="category" value={category}/>}
   <Button type="submit" aria-label="OEM ile ara" className={cn("size-14 rounded-md border-brand bg-brand text-white hover:bg-brand-strong",compact&&"size-12")}><Search className="size-5" aria-hidden="true"/></Button>
  </form>
  <span className="relative mx-[25px] w-4 py-[18px] text-center text-xs font-medium whitespace-nowrap text-white/75 uppercase before:absolute before:top-0 before:left-1/2 before:h-[17px] before:w-px before:bg-[#e6e9ec33] after:absolute after:bottom-0 after:left-1/2 after:h-[17px] after:w-px after:bg-[#e6e9ec33] max-[850px]:mx-4 max-[600px]:hidden">veya</span>
  {/* GarageButton belongs to the site chrome; only its size in this slot is set here. */}
  <div className={cn("contents [&>button]:h-14 [&>button]:min-h-14 [&>button]:w-[320px] max-[850px]:[&>button]:w-[280px] max-[850px]:[&>button]:text-sm min-[601px]:max-[850px]:[&>button]:w-60 min-[601px]:max-[850px]:[&>button]:shrink-0 max-[600px]:[&>button]:mt-3 max-[600px]:[&>button]:w-full",compact&&"[&>button]:h-12 [&>button]:min-h-12 [&>button]:text-sm")}><GarageButton vehicle={vehicle} variant="catalog"/></div>
 </div>;
}
export const catalogDescription=(slug:string)=>descriptions[slug];
// Shared by /katalog and /car-parts/{make}; `make` is the brand resolved from params.make.
export async function CatalogView({params,make}:{params:CatalogQuery;make?:VehicleBrand}) {
 const vehicle=await currentVehicle();
 const vehicleTypeId=(await fitmentVehicle(vehicle))?.typeId ?? null;
 const [result,facetData,account,vehicleBrands,fitCount]=await Promise.all([browseProducts(params,{vehicleTypeId}),catalogFacets(params,{vehicleTypeId}),currentAccount(),getVehicleBrands(),vehicleTypeId?vehicleFitCount(params,vehicleTypeId):0]);
 const products=result.items;
 const [images,logos,details,fitting]=await Promise.all([getCatalogProductImages(products),getManufacturerLogos(products.map(product=>product.brand)),getCatalogProductDetails(products),vehicleTypeId?productsFittingVehicle(products.map(product=>product.id),vehicleTypeId):new Set<string>()]);
 const categories=await getStoreCategories();
 const category=categories.find(c=>c.slug===params.category);
 const isBrakeCategory=category?.path.includes(252);
 const popularOrder=["VOLKSWAGEN","AUDI","TOYOTA","BMW","OPEL","VOLVO","SKODA","RENAULT","MERCEDES-BENZ","PEUGEOT","FORD","KIA","HYUNDAI","SUBARU","MAZDA","CITROËN","NISSAN","LEXUS","HONDA","SEAT"];
 const popularMakes=popularOrder.flatMap(name=>vehicleBrands.filter(brand=>brand.name===name));
 const makeName=make&&(make.name==="VOLKSWAGEN"?"VW":make.name);
 const title=params.q ? `“${params.q.slice(0,120)}” için arama sonuçları` : make ? `${makeName} ${category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları"}` : category?.name ?? "Yedek parça ve bakım ürünleri";
 const home=make?`/car-parts/${params.make}`:"/katalog";
 const filtered=Boolean(params.q || params.brand || params.brands || params.attributes || params.availability || params.fits);
 // Same URL shape as the sidebar filters: the make stays in the path, a page number is dropped.
 const fitsHref=(fits:"vehicle"|undefined)=>{const query=new URLSearchParams();for(const [key,value] of Object.entries({...params,make:undefined,page:undefined,fits}))if(value)query.set(key,value);return query.size?`${home}?${query}`:home;};
 const vehicleName=vehicle&&[vehicle.make,vehicle.model,vehicle.engine].filter(Boolean).join(" ");
 const fitFilter=vehicleTypeId&&(params.fits||fitCount>0)&&<div className={cn("mb-4 flex flex-wrap items-center gap-2.5 rounded-[5px] border border-[#cfe8d9] bg-[#f3faf6] px-3.5 py-2.5 text-[13px] leading-[18px] text-[#1e5e3e] [&>p]:m-0 [&>p]:min-w-[220px] [&>p]:flex-1 [&>p]:text-foreground",params.fits&&"border-[#9fd3b5] bg-[#e8f6ee]")} role="status"><CircleCheck size={18} aria-hidden="true"/>
  {params.fits?<p>Yalnızca garajındaki <strong>{vehicleName}</strong> aracına bağlı ürünler gösteriliyor ({result.total.toLocaleString("tr-TR")} ürün).</p>
   :<p>Bu listede garajındaki <strong>{vehicleName}</strong> aracına bağlı {fitCount.toLocaleString("tr-TR")} ürün var.</p>}
  <Link className="font-semibold whitespace-nowrap text-primary hover:underline" href={fitsHref(params.fits?undefined:"vehicle")} scroll={false}>{params.fits?"Tüm ürünleri göster":"Yalnızca aracıma uyanları göster"}</Link></div>;
 const correction=result.correctedQuery&&<p className="mb-4 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground" role="status">“{params.q}” için sonuç bulunamadı, <strong>“{result.correctedQuery}”</strong> için sonuçlar gösteriliyor.</p>;
 const tooShort=result.searchTooShort&&<p className="mb-4 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground" role="status">Aramak için en az {minSearchLength} harf veya rakam yaz.</p>;
 const scope=result.vehicleScope,partHref=scope&&`${home}?${new URLSearchParams({q:scope.productText,...(category?{category:category.slug}:{})})}`;
 // Product names never name vehicles: a "part + vehicle" query lists the parts linked to that vehicle.
 const vehicleNotice=scope&&<p className="mb-4 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground" role="status">
  {scope.fitted?<>“{scope.vehicleText}” aracına bağlı <strong>“{scope.productText}”</strong> ürünleri gösteriliyor. <Link className="font-semibold text-primary hover:underline" href={partHref!}>Tüm “{scope.productText}” sonuçları</Link></>
   :<>“{scope.vehicleText}” aracına bağlı <strong>“{scope.productText}”</strong> ürünü henüz kayıtlı değil; tüm “{scope.productText}” sonuçları gösteriliyor. Aracına uyduğunu OEM numarasıyla kontrol et.</>}</p>;
 const finder=(compact:boolean)=><CatalogFinder compact={compact} home={home} query={params.q} category={category?.slug} vehicle={vehicle}/>;
 const crumbLink="min-h-0 transition-colors hover:text-primary hover:underline underline-offset-4";
 const crumbSeparator=<BreadcrumbSeparator className="[&>svg]:size-2.5"><ChevronRight/></BreadcrumbSeparator>;
 return (
  <div data-catalog-page="" className="bg-white text-sm leading-5 text-foreground">
   <section className={cn("relative h-[280px] bg-[#212b36] bg-cover bg-center bg-no-repeat pb-10 text-white max-[600px]:h-auto max-[600px]:min-h-[300px] max-[600px]:pb-6",
    isBrakeCategory?"bg-[linear-gradient(#212b36cc,#212b36cc),url('/media/trodo/images/brake-system-banner.webp')]":"bg-[url('/media/trodo/images/mobile-catalog.webp')]")}>
    <div className="flex h-[52px] items-center justify-center gap-2 bg-[#212b3633] text-sm text-white/85 max-[600px]:text-xs"><Search size={18} aria-hidden="true"/><span>Ürün kodu ve OEM numarasıyla parça arama</span></div>
    <div className="mx-auto w-full max-w-[1384px] px-8 max-[600px]:px-[15px]">
     <h1 className="mt-3 mb-4 flex h-24 items-center justify-center text-center text-[34px] leading-[42px] font-semibold tracking-[-.7px] max-[600px]:m-0 max-[600px]:mb-3 max-[600px]:h-[72px] max-[600px]:text-[28px] max-[600px]:leading-9">{title}</h1>
     {finder(false)}
    </div>
   </section>
   <CatalogStickyFinder brakes={Boolean(isBrakeCategory)}>{finder(true)}</CatalogStickyFinder>
   <section className="mx-auto w-[calc(100%-30px)] max-w-[1320px] pb-[50px]">
    <Breadcrumb aria-label="Sayfa yolu" className="min-h-[45px] pt-2 pb-4">
     <BreadcrumbList className="gap-[5px] text-[13px] leading-[21px] text-[#54626e] max-[600px]:text-xs">
      <BreadcrumbItem><BreadcrumbLink className={crumbLink} render={<Link href="/"/>}>Ana sayfa</BreadcrumbLink></BreadcrumbItem>
      {make&&<>{crumbSeparator}<BreadcrumbItem><BreadcrumbLink className={crumbLink} render={<Link href="/automakers"/>}>Araç markaları</BreadcrumbLink></BreadcrumbItem>{crumbSeparator}
       <BreadcrumbItem>{category?<BreadcrumbLink className={crumbLink} render={<Link href={home}/>}>{makeName}</BreadcrumbLink>:<BreadcrumbPage className="text-inherit">{makeName}</BreadcrumbPage>}</BreadcrumbItem></>}
      {!category&&!make&&<>{crumbSeparator}<BreadcrumbItem><span>Katalog</span></BreadcrumbItem></>}
      {category && categoryPath(categories,category.id).map((node,index,path)=><Fragment key={node.id}>{crumbSeparator}<BreadcrumbItem>{index===path.length-1?<BreadcrumbPage className="text-inherit">{node.name}</BreadcrumbPage>:<BreadcrumbLink className={crumbLink} render={<Link href={`${home}?category=${node.slug}`}/>}>{node.name}</BreadcrumbLink>}</BreadcrumbItem></Fragment>)}
     </BreadcrumbList>
    </Breadcrumb>
    {!params.q&&<div className="mb-4 pb-[26px] max-[768px]:pb-4"><h2 className="mb-3 text-[23px] leading-[29px] font-semibold tracking-[-.5px] max-[768px]:text-xl max-[768px]:leading-[26px]">{make&&!category?`${makeName} araçlar için yedek parçaları keşfet`:category?.id===269?"Aracın için ön ve arka fren disklerini keşfet":category?category.name+" ürünlerini keşfet":"Aracına uygun yedek parçayı bul"}</h2><p className="min-h-[54px] text-[13px] leading-[18px]">{make&&!category?`${makeName} modellerine uygun olarak listelenen parçaları kategori ve üreticiye göre incele. Siparişten önce ürün sayfasındaki araç uyumluluğunu, OEM numarasını ve motor bilgilerini kontrol et.`:descriptions[category?.slug??"yedek-parca"]??category?.name+" ürünlerini üretici, montaj konumu ve teknik özelliklerine göre incele. Ürün kodunu veya OEM numarasını kullanarak aradığın parçayı bul ve siparişten önce aracınla uyumunu kontrol et."}</p></div>}
    {!params.q&&!make&&<section className="mb-8 max-[768px]:mb-6" aria-label="Popüler araç markaları"><h2 className="mb-[15px] text-xl leading-7 font-medium tracking-[-.4px]">Popüler araç markaları</h2><ul className="flex flex-wrap gap-x-[3px] max-[600px]:max-h-12 max-[600px]:overflow-auto">{popularMakes.map(make=><li key={make.id} className="text-[13px] leading-[18px] not-last:after:ml-px not-last:after:content-[',']"><Link className="hover:underline" href={"/car-parts/"+vehicleBrandSlug(make.name)}>{make.name==="VOLKSWAGEN"?"VW":make.name}</Link></li>)}</ul></section>}
    <div className="grid grid-cols-[304px_minmax(0,1fr)] items-start gap-8 max-[768px]:grid-cols-1 max-[768px]:gap-5">
     <CatalogSidebar categories={[...categories]} brands={facetData.brands} facets={facetData.attributes} params={params}/>
     <div className="min-w-0">
     {tooShort}{correction}{vehicleNotice}{fitFilter}
    {!filtered&&<CategoryCards className="mt-0 mb-8" categories={categories.filter(node=>category?node.parentId===category.id:node.parentId===null)} basePath={home}/>}
     <CatalogResults count={result.total} page={result.page} pages={result.pages} pageSize={result.pageSize} params={params} defaultView="list">
      {products.length ? products.map(product => <CatalogProduct key={product.id} product={product} details={details.get(product.id)} image={images.get(product.id)} logo={logos.get(product.brand)} account={account} fitsVehicle={fitting.has(product.id)}/>) :
       <div className="col-span-full min-h-[300px] rounded-md border border-border px-6 py-16 text-center"><Search size={38} className="mx-auto mb-5 text-muted-foreground"/><h2 className="mb-3 text-[22px] leading-[30px] font-semibold">{params.fits ? "Bu listede aracına bağlı ürün henüz yok." : filtered ? "Aramana uygun ürün bulunamadı." : "Bu kategorinin ürünleri hazırlanıyor."}</h2><p className="mb-6 text-sm leading-[22px] text-muted-foreground">{params.fits ? "Araç uyumluluk verileri ürün ürün ekleniyor. Tüm ürünlerde OEM numarasıyla arayabilirsin." : filtered ? "Farklı bir ürün kodu deneyebilir veya filtreleri temizleyebilirsin." : "Ürünler eklendiğinde burada listelenecek. Diğer kategorileri inceleyebilirsin."}</p><Button className="h-12 bg-brand px-[27px] hover:bg-brand-strong" nativeButton={false} render={<Link href={home}/>}>Tüm ürünlere göz at</Button></div>}
     </CatalogResults>
     </div>
    </div>
   </section>
   <section className="py-10"><div className="mx-auto grid max-w-[1350px] grid-cols-3 gap-8 px-[15px] max-[768px]:grid-cols-1 max-[768px]:gap-6">
    {benefits.map(({icon:Icon,title,text})=><div key={title} className="flex items-center gap-4"><Icon size={36} strokeWidth={1.4} className="shrink-0 text-muted-foreground"/><span><strong className="text-base leading-6 font-medium">{title}</strong><p className="mt-2 text-[13px] leading-[18px]">{text}</p></span></div>)}
   </div></section>
   {category&&<section className="bg-[#f8f9f9] py-12"><div className="mx-auto max-w-[1350px] px-[15px]"><h2 className="mb-8 text-center text-[28px] leading-9 font-semibold">İlgili kategoriler</h2><CategoryCards variant="related" categories={categories.filter(node=>node.parentId===category.parentId&&node.id!==category.id).slice(0,8)} basePath={home}/></div></section>}
  </div>
 );
}
