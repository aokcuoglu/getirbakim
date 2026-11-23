import { isIndexableListing, type CatalogQuery } from "@/modules/store/catalog-query";
import { isRootCategoryListing } from "@/modules/seo/indexing";
import { Fragment } from "react";
import Link from "next/link";
import { minSearchLength } from "@/modules/search/query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Breadcrumb,BreadcrumbItem,BreadcrumbLink,BreadcrumbList,BreadcrumbPage,BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Search,ChevronRight,ShieldCheck,Truck,CarFront,CircleCheck,Info } from "lucide-react";
import { after } from "next/server";
import { headers } from "next/headers";
import { recordSearch } from "@/modules/search/analytics";
import { typeNameFirstPage } from "@/modules/search/type-names";
import { browseProducts,isPlainSearch,catalogFacets,vehicleFitCount,vehicleLead,productsFittingVehicle,servicePrice } from "@/modules/store/catalog";
import { fitmentVehicle } from "@/modules/store/fitment-level.server";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { GarageButton } from "@/components/garage/garage-button";
import { HeroBackdrop } from "@/components/hero-backdrop";
import { CatalogSidebar,CatalogResults,CatalogFilterSheet } from "@/components/catalog-controls";
import { CatalogActiveFilters } from "@/components/catalog-active-filters";
import { activeFilters,clearAllFilters,selectedAttributes } from "@/modules/store/catalog-filters";
import { withSelectedOptions } from "@/modules/store/specification-translations";
import { CatalogProduct } from "@/components/catalog-product";
import { getCatalogProductImages,getCatalogProductDetails } from "@/modules/store/product-enrichment";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import {shownVehicle,vehicleText} from "@/modules/store/vehicle-label";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,popularVehicleMakes,type ShownVehicle,type VehicleBrand} from "@/modules/store/vehicle-catalog";
import {vehicleMakeLabel,vehicleModelCategoryLabels,vehicleModelGroupYears,vehicleModelLabels,withModelYears,type VehicleModelGroup} from "@/modules/store/vehicle-model-groups";
import {VehicleModelSummary} from "@/components/vehicle-model-summary";
import {VehicleModelList} from "@/components/vehicle-model-list";
import {getStoreCategories} from "@/modules/store/categories";
import {categoryNameInText,categoryPath,sidebarCategoryBranch} from "@/modules/store/category-tree";
import {CatalogStickyFinder} from "@/components/catalog-sticky-finder";
import {CategoryCards} from "@/components/category-cards";
import {CatalogCategoryChips} from "@/components/catalog-category-chips";
import {defaultListingView} from "@/modules/store/listing-card";
import {VehicleOilBanner} from "@/components/vehicle-oil-banner";
import {getVehicleOilSpec} from "@/modules/store/vehicle-oil.server";
import {engineOilCategoryId,oilFilterParam,parseOilFilters,type OilFilter} from "@/modules/store/vehicle-oil";
import {JsonLd} from "@/components/json-ld";
import {breadcrumbJsonLd,catalogTrail,collectionJsonLd} from "@/modules/seo/structured-data";
import {listingPath,listingUrl,makePath} from "@/modules/seo/paths";
import {vehicleCategoryHeading,vehicleCategoryTexts} from "@/modules/seo/meta-text";
import {productPath} from "@/modules/seo/product-path";
import {catalogCardTitle} from "@/modules/store/product-override-display";
import {siteUrl} from "@/lib/site";
import {TrackItemList} from "@/components/privacy/track-events";
import {catalogItem} from "@/modules/analytics/events";
import {legacyCategoryIds} from "@/modules/store/category-tree";
import {manufacturerTexts,manufacturerTrail} from "@/modules/store/manufacturers";
import {scopeCategoryCounts} from "@/modules/store/listing-categories.server";
import { storeButton } from "@/components/store-button";
import brakeBannerMobile from "@/assets/hero/brake-system-banner-mobile.webp";
import brakeBanner from "@/assets/hero/brake-system-banner.webp";
import catalogBanner from "@/assets/hero/mobile-catalog.webp";
import {catalogDescription} from "./catalog-descriptions";
import {categoryGuideNote} from "@/content/category-guides";
import {CategoryGuideNote} from "@/components/category-guide-note";
const benefits=[
 {icon:ShieldCheck,title:"Sipariş bilgilerin tek yerde",text:"Ürün, fiyat ve teslimat bilgilerini birlikte incele."},
 {icon:Truck,title:"Teslimat ve iade bilgileri",text:"Sipariş öncesi teslimat ve iade koşullarını öğren."},
 {icon:CarFront,title:"Parça uyumluluğunu kontrol et",text:"OEM numarasını ve araç bilgilerini karşılaştır."},
];
// OEM code search plus the garage picker; `compact` is the smaller copy inside the sticky finder. On a phone the hero shows
// only the garage picker: the header's search has the OEM / code mode (#878). From 600 to 767px the hero's copy stacks: the
// box takes the full width (its placeholder unclipped) and the garage picker goes under it; 768px up is unchanged.
function CatalogFinder({compact,home,query,vehicle}:{compact:boolean;home:string;query?:string;vehicle:ShownVehicle|null}){
 return <div className={cn("flex items-center justify-center py-1 max-[600px]:mx-auto max-[600px]:max-w-[400px] max-[600px]:flex-wrap",compact?"h-20 px-[15px] py-4":"min-[600px]:max-[768px]:mx-auto min-[600px]:max-[768px]:max-w-[560px] min-[600px]:max-[768px]:flex-wrap")}>
  <form action={home} className={cn("flex min-w-0 gap-2.5 max-[600px]:w-full",!compact&&"max-[600px]:hidden min-[600px]:max-[768px]:w-full")} role="search" aria-label="OEM numarasıyla parça ara">
   <label className={cn("flex h-14 w-[296px] overflow-hidden rounded-md border border-white bg-white min-[600px]:max-[850px]:w-60 max-[600px]:w-auto max-[600px]:min-w-0 max-[600px]:flex-1",compact?"h-12 w-[245px]":"min-[600px]:max-[768px]:w-auto! min-[600px]:max-[768px]:flex-1")}>
    <span aria-hidden="true" className="flex flex-[0_0_36px] items-center justify-center bg-[#003399] text-[11px] font-semibold text-white">OEM</span>
    <input type="search" name="q" aria-label="Ürün kodu veya OEM numarası" placeholder="Ürün kodu veya OEM numarası" defaultValue={query} minLength={2} maxLength={120} required
     className={cn("h-[54px] w-full min-w-0 border-0 bg-white px-2.5 py-3.5 text-sm text-ellipsis text-[#54626e] outline-none placeholder:text-ellipsis placeholder:text-[#637381]",compact&&"h-[46px]")}/>
   </label>
   <input type="hidden" name="searchBy" value="code"/>
   <Button type="submit" aria-label="OEM ile ara" className={cn(storeButton({intent:"primary",size:compact?"lg":"hero"}),"px-0",compact?"w-12":"w-14")}><Search className="size-5" aria-hidden="true"/></Button>
  </form>
  <span className={cn("relative mx-[25px] w-4 py-[18px] text-center text-xs font-medium whitespace-nowrap text-white/75 uppercase before:absolute before:top-0 before:left-1/2 before:h-[17px] before:w-px before:bg-[#e6e9ec33] after:absolute after:bottom-0 after:left-1/2 after:h-[17px] after:w-px after:bg-[#e6e9ec33] max-[850px]:mx-4 max-[600px]:hidden",!compact&&"min-[600px]:max-[768px]:hidden")}>veya</span>
  {/* GarageButton belongs to the site chrome; only its size in this slot is set here. */}
  <div className={cn("contents [&>button]:h-14 [&>button]:min-h-14 [&>button]:w-[320px] max-[850px]:[&>button]:w-[280px] max-[850px]:[&>button]:text-sm min-[600px]:max-[850px]:[&>button]:w-60 [&>button]:min-w-0 max-[600px]:[&>button]:w-full",compact?"[&>button]:h-12 [&>button]:min-h-12 [&>button]:text-sm":"min-[600px]:max-[768px]:[&>button]:mt-3 min-[600px]:max-[768px]:[&>button]:w-full!")}><GarageButton vehicle={vehicle} variant="catalog"/></div>
 </div>;
}
// Shared by /katalog, /kategori/{category}[/{make}[/{model}]] and /yedek-parca/{make}[/{model}]; `make` is the brand
// resolved from params.make, `model` the model page unit resolved from params.model (#639) and `plainTotal` a gated
// listing's unfiltered count (model, model × category and make × category pages; #673).
// /marka/{manufacturer} (#660) passes the manufacturer of params.manufacturer and its unfiltered count.
export async function CatalogView({params,make,model,plainTotal,manufacturer,manufacturerTotal}:{params:CatalogQuery;make?:VehicleBrand;model?:VehicleModelGroup;plainTotal?:number;manufacturer?:{name:string;slug:string};manufacturerTotal?:number}) {
 const vehicle=await currentVehicle();
 const vehicleTypeId=(await fitmentVehicle(vehicle))?.typeId ?? null;
 // Page 1 without the fit filter puts the garage vehicle's fits first (#884): the first cards of the fits=vehicle listing
 // above the results, which stay unfiltered (DESIGN.md: the vehicle does not filter the catalog). Later pages keep the
 // offer box and its count only; both counts are the fits=vehicle listing's, every filter kept. The lead is read next to
 // the listing when the URL asks for page 1, afterwards when the listing clamps another page number to 1 (?page=99).
 const askedFirstPage=!(Number(params.page)>1);
 const vehicleFits=async(typeId:string)=>askedFirstPage?vehicleLead(params,typeId):{items:[],total:await vehicleFitCount(params,typeId)};
 const [result,facetData,account,vehicleBrands,fitsRead,oilSpec]=await Promise.all([browseProducts(params,{vehicleTypeId}),catalogFacets(params,{vehicleTypeId}),currentAccount(),getVehicleBrands(),vehicleTypeId&&!params.fits?vehicleFits(vehicleTypeId):{items:[],total:0},getVehicleOilSpec(vehicleTypeId)]);
 const leadPage=!params.fits&&result.page===1;
 const fits=vehicleTypeId&&leadPage&&!askedFirstPage?await vehicleLead(params,vehicleTypeId):fitsRead;
 // When every listed product fits, the lead would only repeat the results' first cards.
 const products=result.items,fitCount=fits.total,leadProducts=leadPage&&fitCount<result.total?fits.items:[];
 // The cards of both lists; a product of the lead is listed again in the results.
 const cards=[...new Map([...products,...leadProducts].map(product=>[product.id,product])).values()];
 // Search analytics (#822): a plain search's first page, counted after the response; crawlers and prefetches are not shoppers.
 if(isPlainSearch(params)&&result.page===1){
  const request=await headers();
  const crawler=/bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(request.get("user-agent")??"");
  const prefetch=request.has("next-router-prefetch")||/prefetch/i.test(request.get("sec-purpose")??request.get("purpose")??"");
  const mode=params.searchBy==="code"?"code":"all";
  // #989: how many first-page cards the type-name expansion translated, measured after the response too; a corrected
  // search ran the corrected query.
  if(!crawler&&!prefetch)after(()=>recordSearch({query:params.q!,mode,total:result.total,correctedQuery:result.correctedQuery,typeNameFirstPage:typeNameFirstPage(result.correctedQuery??params.q!,mode,result.items)}));
 }
 const [images,logos,details,fitting]=await Promise.all([getCatalogProductImages(cards),getManufacturerLogos(cards.map(product=>product.display_brand)),getCatalogProductDetails(cards),vehicleTypeId?productsFittingVehicle(cards.map(product=>product.id),vehicleTypeId):new Set<string>()]);
 // On a make or model listing only the categories holding its products are linked: an empty one would be a 404 (#673).
 const [categories,scopeCounts]=await Promise.all([getStoreCategories(),make?scopeCategoryCounts({make:params.make,model:params.model}):undefined]);
 const category=categories.find(c=>c.slug===params.category);
 const shownCategories=scopeCounts?categories.filter(node=>scopeCounts.has(node.id)):categories;
 // On a make or model listing the root "Yedek parçalar" (legacy id 3) would repeat the make or model page itself: the
 // sidebar's "Üst kategori" of its children leads back to that page instead (parent null → listingPath without category).
 const branch=sidebarCategoryBranch(shownCategories,params.category);
 const sidebarBranch=make&&branch.parent?.slug==="yedek-parca"?{...branch,parent:null}:branch;
 const subcategories=shownCategories.filter(node=>category?node.parentId===category.id:node.parentId===null);
 const related=category?shownCategories.filter(node=>node.parentId===category.parentId&&node.id!==category.id).slice(0,8):[];
 const isBrakeCategory=category?.path.includes(252);
 const popularMakes=popularVehicleMakes.flatMap(name=>vehicleBrands.filter(brand=>brand.name===name));
 const makeName=make&&vehicleMakeLabel(make.name);
 const modelLabels=make&&model?vehicleModelLabels(make.name,model):undefined,modelName=modelLabels?.name,modelYears=model&&vehicleModelGroupYears(model);
 // A category name inside a sentence keeps its all-caps words (ABS, LED); the model with its years, one parenthesis.
 const parts=category&&categoryNameInText(category.name),modelVehicle=modelName&&withModelYears(modelName,modelYears);
 const manufacturerCopy=manufacturer&&manufacturerTexts(manufacturer.name,manufacturerTotal??result.total);
 const title=params.q ? `“${params.q.slice(0,120)}” için arama sonuçları` : manufacturerCopy ? manufacturerCopy.title : modelLabels ? (make && model && parts ? vehicleModelCategoryLabels(make.name,model,parts).heading : modelLabels.heading) : make ? `${makeName} ${parts ?? "yedek parçaları"}` : category?.name ?? "Yedek parça ve bakım ürünleri";
 // The listing itself (the code search stays inside it) and the same listing without its category.
 const modelSlug=model&&params.model;
 const manufacturerSlug=manufacturer?.slug;
 const home=listingPath({makeSlug:params.make,modelSlug,categorySlug:params.category,manufacturerSlug}),allProducts=listingPath({makeSlug:params.make,modelSlug,manufacturerSlug});
 const filtered=Boolean(params.q || params.brand || params.brands || params.attributes || params.availability || params.fits || params.oil);
 // Same URL shape as the sidebar filters: make and category stay in the path, a page number is dropped.
 const listingHref=(updates:Partial<CatalogQuery>)=>listingUrl(params,updates);
 const fitsHref=(fits:"vehicle"|undefined)=>listingHref({fits});
 const shown=shownVehicle(vehicle),vehicleName=shown&&vehicleText(shown);
 // The fit filter itself shows as a removable chip ("Aracına uyanlar"); this box only offers it, on pages without the lead.
 const fitFilter=vehicleTypeId&&!params.fits&&!leadProducts.length&&fitCount>0&&fitCount<result.total&&<div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[5px] border border-[#cfe8d9] bg-[#f3faf6] px-3.5 py-2.5 text-[13px] leading-[18px] text-[#1e5e3e] [&>p]:m-0 [&>p]:min-w-[220px] [&>p]:flex-1 [&>p]:text-foreground" role="status"><CircleCheck size={18} aria-hidden="true"/>
  <p>Bu listede garajındaki <strong>{vehicleName}</strong> aracına bağlı {fitCount.toLocaleString("tr-TR")} ürün var.</p>
  <Link className="font-semibold whitespace-nowrap text-primary hover:underline" href={fitsHref("vehicle")} scroll={false}>Yalnızca aracıma uyanları göster</Link></div>;
 const card=(product:(typeof cards)[number])=><CatalogProduct key={product.id} product={product} details={details.get(product.id)} image={images.get(product.id)} logo={logos.get(product.display_brand)} account={account} fitsVehicle={fitting.has(product.id)} vehicleChecked={Boolean(vehicleTypeId)}/>;
 // The vehicle's fits before the results (#884): one sideways-scrolling row on phones and tablets, two columns from 769px and
 // one row of three from 993px (the fourth card hidden there when the link leads to it); always grid cards (its own
 // `group/listing`), whatever view the results take. Then "Tüm sonuçlar" with its toolbar and chips (CatalogResults).
 const leadTotal=fitCount.toLocaleString("tr-TR"),moreFits=fitCount>leadProducts.length;
 const lead=leadProducts.length>0&&<>
  <section aria-labelledby="aracina-uyanlar" className="mb-8 max-[768px]:mb-6">
   <h2 id="aracina-uyanlar" className="mb-3 flex items-start gap-2 text-lg leading-6 font-semibold max-[600px]:text-base max-[600px]:leading-[22px]"><CarFront size={20} className="mt-0.5 shrink-0 text-foreground" aria-hidden="true"/><span><strong>{vehicleName}</strong> aracına uyanlar · {leadTotal} ürün</span></h2>
   <div className="group/listing relative max-[768px]:after:pointer-events-none max-[768px]:after:absolute max-[768px]:after:inset-y-0 max-[768px]:after:right-0 max-[768px]:after:w-4 max-[768px]:after:bg-linear-to-l max-[768px]:after:from-white" data-view="grid">
    <div role="region" aria-label={`${vehicleName} aracına uyan ürünler`} className={cn("flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 max-[768px]:*:w-[46vw] max-[768px]:*:min-w-40 max-[768px]:*:shrink-0 max-[768px]:*:snap-start min-[769px]:mx-[-2px] min-[769px]:grid min-[769px]:grid-cols-2 min-[769px]:gap-x-4 min-[769px]:gap-y-6 min-[769px]:overflow-visible min-[769px]:pb-0 min-[993px]:grid-cols-3",moreFits&&"min-[993px]:[&>:nth-child(n+4)]:hidden")}>{leadProducts.map(card)}</div>
   </div>
   {moreFits&&<Link className="mt-3 inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline" href={fitsHref("vehicle")} scroll={false}>Uyan {leadTotal} ürünün tümünü göster<ChevronRight size={16} aria-hidden="true"/></Link>}
  </section>
  <h2 className="mb-4 text-lg leading-6 font-semibold max-[600px]:text-base max-[600px]:leading-[22px]">Tüm sonuçlar</h2>
 </>;
 // Chips name a selected value the facets no longer offer the way the sidebar would.
 const chipFacets=withSelectedOptions(facetData.attributes,selectedAttributes(params));
 const chips=activeFilters(params,chipFacets,{vehicleName:vehicleName||undefined}).map(item=>({key:item.key,label:item.label,href:listingHref(item.remove)}));
 const oilFilters=parseOilFilters(params.oil);
 // Engine-oil listings: the oil categories, an oil filter, or a search for engine oil or a grade ("5w30").
 const oilListing=oilFilters.size>0||Boolean(category&&(category.path.includes(engineOilCategoryId)||category.id===legacyCategoryIds.yag))||/motor\s*ya[gğ]|\b\d{1,2}w-?\d{2}\b/i.test(params.q??"");
 const fitNoteClass="mb-4 flex items-start gap-2.5 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground";
 const fitNote=vehicle&&!result.searchTooShort&&(vehicleTypeId
  ?!(params.fits||fitCount>0)&&products.length>0&&!result.vehicleScope&&<p className={fitNoteClass} role="status"><Info size={18} className="mt-px shrink-0 text-primary" aria-hidden="true"/><span>Bu listede garajındaki <strong>{vehicleName}</strong> aracına bağlı ürün bulunamadı. Ürünlerin uyumunu ürün sayfasında veya OEM numarasıyla kontrol et.</span></p>
  :<p className={fitNoteClass} role="status"><Info size={18} className="mt-px shrink-0 text-primary" aria-hidden="true"/><span>Garajındaki <strong>{vehicleName}</strong> için uyum kontrolü yapılamıyor; aracını marka ve modelden seçersen uyan ürünleri gösterebiliriz.</span></p>);
 const oilBanner=oilSpec&&oilListing&&vehicleName&&<VehicleOilBanner spec={oilSpec} vehicleName={vehicleName} active={oilFilters} total={result.total}
  href={(filters:OilFilter[])=>listingHref({oil:oilFilterParam(new Set(filters))})}/>;
 const correction=result.correctedQuery&&<p className="mb-4 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground" role="status">“{params.q}” için sonuç bulunamadı, <strong>“{result.correctedQuery}”</strong> için sonuçlar gösteriliyor.</p>;
 const tooShort=result.searchTooShort&&<p className="mb-4 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground" role="status">Aramak için en az {minSearchLength} harf veya rakam yaz.</p>;
 const scope=result.vehicleScope,partHref=scope&&listingUrl({make:params.make,model:modelSlug,category:category?.slug,manufacturer:manufacturerSlug,q:scope.productText});
 // Product names never name vehicles: a "part + vehicle" query lists the parts linked to that vehicle.
 const vehicleNotice=scope&&<p className="mb-4 rounded-[5px] border border-border bg-[#f8fafc] px-3.5 py-2.5 text-[13px] leading-[18px] text-foreground" role="status">
  {scope.fitted?<>“{scope.vehicleText}” aracına bağlı <strong>“{scope.productText}”</strong> ürünleri gösteriliyor. <Link className="font-semibold text-primary hover:underline" href={partHref!}>Tüm “{scope.productText}” sonuçları</Link></>
   :<>“{scope.vehicleText}” aracına bağlı <strong>“{scope.productText}”</strong> ürünü bulunamadı; tüm “{scope.productText}” sonuçları gösteriliyor. Aracına uyduğunu OEM numarasıyla kontrol et.</>}</p>;
 const trail=manufacturer?manufacturerTrail(manufacturer):catalogTrail({make:make&&{name:makeName!,slug:params.make!},model:model&&{name:modelLabels!.model,slug:params.model!},categories:category?categoryPath(categories,category.id):[]});
 // Only the plain listings are indexed (the pages' robots rule): a search, filter, sort or page 2 is not a collection.
 // A model page says what its list is: model-level fits, which the garage vehicle narrows to an engine type.
 const intro=params.q?undefined:manufacturerCopy?manufacturerCopy.intro:modelVehicle&&parts?vehicleCategoryTexts(modelVehicle,parts,plainTotal??result.total,"model").intro:modelVehicle?`${modelVehicle} için listelenen ${(plainTotal??result.total).toLocaleString("tr-TR")} parça. Liste model düzeyindedir: ürünler bu modelin bir motor tipine bağlı ya da tedarikçinin ürün açıklamasında bu model geçiyor. Siparişten önce ürün sayfasındaki araç uyumluluğunu ve OEM numarasını kontrol et.`:make&&category&&parts&&!model?vehicleCategoryTexts(makeName!,parts,plainTotal??result.total,"make").intro:make&&!category?`${makeName} modellerine uygun olarak listelenen parçaları kategori ve üreticiye göre incele. Siparişten önce ürün sayfasındaki araç uyumluluğunu, OEM numarasını ve motor bilgilerini kontrol et.`:catalogDescription(category?.slug??"yedek-parca")??category?.name+" kategorisindeki ürünleri üretici, montaj konumu ve teknik özelliklerine göre incele. Ürün kodunu veya OEM numarasını kullanarak aradığın parçayı bul ve siparişten önce aracınla uyumunu kontrol et.";
  const guideNote=products.length>0?categoryGuideNote(params,{vehicle:Boolean(make||model),manufacturer:Boolean(manufacturer)}):undefined;
  const collection=isIndexableListing(params)&&!isRootCategoryListing(params)&&products.length>0
  ?collectionJsonLd({name:title,description:intro,path:listingPath({makeSlug:params.make,modelSlug,categorySlug:category?.slug,manufacturerSlug}),items:products.map(product=>({path:productPath(product),name:catalogCardTitle(product,details.get(product.id)?.partNumber)}))},siteUrl):null;
 // The OEM box repeats only a code search; a name search belongs to the header's box.
 const finder=(compact:boolean)=><CatalogFinder compact={compact} home={home} query={params.searchBy==="code"?params.q:undefined} vehicle={shown}/>;
 const crumbLink="min-h-0 transition-colors hover:text-primary hover:underline underline-offset-4";
 const crumbSeparator=<BreadcrumbSeparator className="[&>svg]:size-2.5"><ChevronRight/></BreadcrumbSeparator>;
 return (
  <div data-catalog-page="" className="bg-white text-sm leading-5 text-foreground">
   <section className="relative h-[280px] bg-[#212b36] pb-10 text-white min-[600px]:max-[768px]:h-auto max-[600px]:h-auto max-[600px]:min-h-0 max-[600px]:pb-4">
    {isBrakeCategory?<HeroBackdrop mobile={brakeBannerMobile} desktop={brakeBanner}/>
     :<HeroBackdrop desktop={catalogBanner} overlay={false}/>}
    <div className="relative flex h-[52px] items-center justify-center gap-2 bg-[#212b3633] text-sm text-white/85 max-[600px]:hidden"><Search size={18} aria-hidden="true"/><span>Ürün kodu ve OEM numarasıyla parça arama</span></div>
    <div className="relative mx-auto w-full max-w-[1384px] px-8 max-[600px]:px-[15px]">
     {/* Manufacturer names and make / model headings ("Volkswagen Golf 7 (2012–2022) fren sistemi") can run to three
      lines on a phone: they grow from the same minimum height instead of overflowing the fixed one. On a phone the
      heading takes only its own lines, so the products start higher (#878). */}
     <h1 className={cn("mt-3 mb-4 flex items-center justify-center text-center text-[34px] leading-[42px] font-semibold tracking-[-.7px] max-[600px]:m-0 max-[600px]:py-3 max-[600px]:text-[22px] max-[600px]:leading-7",
      manufacturer?"min-h-24 text-balance wrap-anywhere max-[600px]:min-h-0":make?"min-h-24 py-2 text-balance max-[600px]:min-h-0":"h-24 max-[600px]:h-auto")}>{title}</h1>
     {finder(false)}
    </div>
   </section>
   <JsonLd data={breadcrumbJsonLd(trail,siteUrl)}/><JsonLd data={collection}/><TrackItemList listId={category?.slug??params.make??(manufacturerSlug&&`marka-${manufacturerSlug}`)??"katalog"} listName={title} searchTerm={params.q} items={products.flatMap((product,index)=>product.price_kurus===null||product.unavailable?[]:[catalogItem({id:product.id,name:catalogCardTitle(product,details.get(product.id)?.partNumber),brand:product.display_brand,category:category?.name},servicePrice(product.price_kurus,account?.approved&&account.role==="service"?account.discount_percent:0),{index})])}/>
   <CatalogStickyFinder banner={isBrakeCategory?brakeBanner.src:undefined}>{finder(true)}</CatalogStickyFinder>
   {/* Phones (≤768px) put the products before the introduction and the popular makes, the DOM order staying (#878). */}
   <section className="mx-auto w-[calc(100%-30px)] max-w-[1320px] pb-[50px] max-[768px]:flex max-[768px]:flex-col">
    <Breadcrumb aria-label="Sayfa yolu" className="min-h-[45px] pt-2 pb-4">
     <BreadcrumbList className="gap-[5px] text-[13px] leading-[21px] text-[#54626e] max-[600px]:text-xs">
      {trail.map((crumb,index)=><Fragment key={crumb.path}>{index>0&&crumbSeparator}<BreadcrumbItem>{index===trail.length-1?<BreadcrumbPage className="text-inherit">{crumb.name}</BreadcrumbPage>:<BreadcrumbLink className={crumbLink} render={<Link href={crumb.path}/>}>{crumb.name}</BreadcrumbLink>}</BreadcrumbItem></Fragment>)}
     </BreadcrumbList>
    </Breadcrumb>
    {/* On phones the products show before the introduction, the DOM order staying: a keyboard or screen reader user skips to them.
     Not `sr-only`: globals.css's .sr-only clips with clip: rect(0,0,0,0), which `not-sr-only` does not undo. */}
    <a href="#urunler" className="absolute size-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)] focus:static focus:mb-4 focus:inline-block focus:size-auto focus:self-start focus:overflow-visible focus:rounded-md focus:border focus:border-border focus:bg-white focus:px-4 focus:py-3 focus:font-medium focus:text-primary focus:[clip-path:none] focus-visible:outline-2 focus-visible:outline-ring">Ürünlere geç</a>
    {!params.q&&<div className="mb-4 pb-[26px] max-[768px]:order-2 max-[768px]:pb-4"><h2 className="mb-3 text-[23px] leading-[29px] font-semibold tracking-[-.5px] max-[768px]:text-xl max-[768px]:leading-[26px]">{manufacturerCopy?manufacturerCopy.heading:modelName&&parts?vehicleCategoryHeading(modelName,parts,"model"):makeName&&parts&&!model?vehicleCategoryHeading(makeName,parts,"make"):modelName?`${modelName} için yedek parçaları keşfet`:make&&!category?`${makeName} araçlar için yedek parçaları keşfet`:category?.id===269?"Aracın için ön ve arka fren disklerini keşfet":category?category.name+" ürünlerini keşfet":"Aracına uygun yedek parçayı bul"}</h2><p className="text-[13px] leading-[18px]">{intro}</p>{model&&modelName&&!category&&<VehicleModelSummary name={modelName} model={model} vehicle={shown}/>}</div>}
    {make&&!model&&!category&&!params.q&&!filtered&&<VehicleModelList brandId={make.id} makeName={makeName!} makeSlug={params.make!}/>}
    {!params.q&&!make&&<section className="mb-8 max-[768px]:order-2 max-[768px]:mb-6" aria-label="Popüler araç markaları"><h2 className="mb-[15px] text-xl leading-7 font-medium tracking-[-.4px]">Popüler araç markaları</h2><ul className="flex flex-wrap gap-x-[3px]">{popularMakes.map(make=><li key={make.id} className="make-list-item"><Link prefetch={false} className="hover:underline" href={makePath(vehicleBrandSlug(make.name))}>{vehicleMakeLabel(make.name)}</Link></li>)}</ul></section>}
    <div id="urunler" tabIndex={-1} className="grid scroll-mt-4 grid-cols-[304px_minmax(0,1fr)] items-start gap-8 outline-none max-[768px]:order-1 max-[768px]:mb-8 max-[768px]:grid-cols-1 max-[768px]:gap-5">
     <CatalogSidebar branch={manufacturer?null:sidebarBranch} listed={scopeCounts&&[...scopeCounts.keys()]} brands={facetData.brands} facets={facetData.attributes} params={params}/>
     <div className="min-w-0">
     {tooShort}{correction}{vehicleNotice}{oilBanner}{fitFilter}{fitNote}
    {!filtered&&!manufacturer&&<><CatalogCategoryChips categories={subcategories} makeSlug={params.make} modelSlug={modelSlug}/><CategoryCards className="mt-0 mb-8 max-[768px]:hidden" categories={subcategories} makeSlug={params.make} modelSlug={modelSlug}/></>}
     <CatalogResults count={result.total} page={result.page} pages={result.pages} pageSize={result.pageSize} params={params} defaultView={defaultListingView(account)}
      filters={<CatalogFilterSheet brands={facetData.brands} facets={facetData.attributes} chipFacets={chipFacets} params={params} count={result.total} vehicleName={vehicleName||undefined}/>}
      active={<CatalogActiveFilters items={chips} clearHref={listingHref(clearAllFilters)}/>} lead={lead||undefined}>
      {products.length ? products.map(card) :
       <div className="col-span-full min-h-[300px] rounded-md border border-border px-6 py-16 text-center"><Search size={38} className="mx-auto mb-5 text-muted-foreground"/><h2 className="mb-3 text-[22px] leading-[30px] font-semibold">{params.fits ? "Bu listede aracına bağlı ürün bulunamadı." : params.oil ? "Aracının yağ önerisine uyan ürün bulunamadı." : filtered ? "Aramana uygun ürün bulunamadı." : "Bu kategoride şu an ürün bulunmuyor."}</h2><p className="mb-6 text-sm leading-[22px] text-muted-foreground">{params.fits ? "Tüm ürünlerde OEM numarasıyla arayabilir veya araç filtresini kaldırabilirsin." : params.oil ? "Yağ filtrelerinden birini kaldırarak benzer özellikteki yağları görebilirsin." : filtered ? "Farklı bir ürün kodu deneyebilir veya filtreleri temizleyebilirsin." : "Diğer kategorileri inceleyebilir veya aradığın parça için bize ulaşabilirsin."}</p><Button className={storeButton({intent:"primary",size:"lg"})} nativeButton={false} render={<Link href={allProducts}/>}>Tüm ürünlere göz at</Button></div>}
     </CatalogResults>
     </div>
    </div>
   </section>
   {guideNote&&<CategoryGuideNote note={guideNote.note} guides={guideNote.guides}/>}
   <section className="py-10"><div className="mx-auto grid max-w-[1350px] grid-cols-3 gap-8 px-[15px] max-[768px]:grid-cols-1 max-[768px]:gap-6">
    {benefits.map(({icon:Icon,title,text})=><div key={title} className="flex items-center gap-4"><Icon size={36} strokeWidth={1.4} className="shrink-0 text-muted-foreground"/><span><strong className="text-base leading-6 font-medium">{title}</strong><p className="mt-2 text-[13px] leading-[18px]">{text}</p></span></div>)}
   </div></section>
   {related.length>0&&<section className="bg-[#f8f9f9] py-12"><div className="mx-auto max-w-[1350px] px-[15px]"><h2 className="mb-8 text-center text-[28px] leading-9 font-semibold">İlgili kategoriler</h2><CategoryCards variant="related" categories={related} makeSlug={params.make} modelSlug={modelSlug}/></div></section>}
  </div>
 );
}
