import Link from "next/link";
import Image from "next/image";
import {Info,Gauge} from "lucide-react";
import {PartArt} from "@/components/part-art";
import {categories,money,servicePrice,type CatalogProduct as CatalogEntry} from "@/modules/store/catalog";
import type {Account} from "@/modules/auth/session";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {PurchaseForm} from "@/components/purchase-form";
import {ManufacturerBadge} from "@/components/manufacturer-badge";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import {specificationValue} from "@/modules/store/catalog-filters";
import {Badge} from "@/components/ui/badge";
import {cn} from "@/lib/utils";
import {CardSpecifications,CompareCheckbox} from "./catalog-card-controls";
type Details={specifications:[string,string][];vehicleSpecific:boolean;partNumber:string};

// Rendered inside CatalogResults (`group/listing`, data-view="list"|"grid"): every `group-data-[view=grid]/listing:` class is the grid layout.
/** `fitsVehicle`: linked to the garage vehicle's engine type. */
export function CatalogProduct({product:p,image,logo,account,details,fitsVehicle=false}:{product:CatalogEntry;image?:CatalogProductImage;logo?:ManufacturerLogo;account:Account|null;details?:Details;fitsVehicle?:boolean}){
 const discounted=Boolean(account?.approved&&account.role==="service"),category=categories.find(c=>c.slug===p.category);
 const displayName=p.name.toLowerCase().replace(/\bon\b/g,"ön").split(" ").map(word=>word.charAt(0).toLocaleUpperCase("tr")+word.slice(1)).join(" ");
 const title=displayName+" "+p.brand+" "+(details?.partNumber??p.code).replace(new RegExp("^"+p.brand.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s+","i"),"");
 const specifications=details?.specifications??([["Üretici",p.brand],...(p.oem?[["OEM",p.oem]]:[])] as [string,string][]);
 const brandClass=details?.specifications.find(s=>s[0]==="Brand class")?.[1];
 const price=p.price_kurus===null?"Fiyat bilgisi güncelleniyor":money(servicePrice(p.price_kurus,discounted?account!.discount_percent:0));
 return <article className="grid min-w-0 grid-cols-[240px_minmax(0,1fr)] gap-6 rounded-[10px] border border-[#dfe3e8] bg-white p-5 max-[992px]:grid-cols-[minmax(0,1fr)_180px] max-[600px]:relative max-[600px]:block max-[600px]:p-4 group-data-[view=grid]/listing:flex group-data-[view=grid]/listing:flex-col group-data-[view=grid]/listing:gap-3 group-data-[view=grid]/listing:p-4 max-[600px]:group-data-[view=grid]/listing:p-2">
 <div className="relative min-w-0 self-start max-[992px]:col-start-2 max-[992px]:row-start-1 max-[600px]:absolute max-[600px]:top-4 max-[600px]:right-4 max-[600px]:w-[110px] group-data-[view=grid]/listing:w-full max-[600px]:group-data-[view=grid]/listing:relative max-[600px]:group-data-[view=grid]/listing:inset-auto max-[600px]:group-data-[view=grid]/listing:w-full">
  <div className="absolute top-0 left-0 z-1 flex items-center gap-2 max-[600px]:relative max-[600px]:mb-3 max-[600px]:gap-1.5 max-[600px]:group-data-[view=grid]/listing:absolute max-[600px]:group-data-[view=grid]/listing:mb-0 max-[600px]:group-data-[view=grid]/listing:gap-1">
   {brandClass&&<span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-white max-[600px]:group-data-[view=grid]/listing:size-6",brandClass==="Premium"?"bg-[#d72b2b]":brandClass==="Budget"?"bg-[#f59e0b]":"bg-[#2e7d32]")} title={specificationValue(brandClass)} aria-label={specificationValue(brandClass)}>{brandClass==="Premium"||brandClass==="Budget"?<Image src={"/media/trodo/icons/"+brandClass.toLowerCase()+".svg"} width={16} height={16} alt="" unoptimized/>:<Gauge size={18}/>}</span>}
   <ManufacturerBadge brand={p.brand} logo={logo} className="inline-flex min-h-8 items-center rounded-md border border-[#dfe3e8] bg-white/92 px-1 pt-[3px] pb-1 text-sm leading-5 font-medium [&_img]:h-[23px]! [&_img]:w-auto! [&_img]:max-w-[80px]! max-[600px]:group-data-[view=grid]/listing:min-h-6 max-[600px]:group-data-[view=grid]/listing:px-1 max-[600px]:group-data-[view=grid]/listing:py-px max-[600px]:group-data-[view=grid]/listing:text-xs max-[600px]:group-data-[view=grid]/listing:[&_img]:h-[18px]! max-[600px]:group-data-[view=grid]/listing:[&_img]:max-w-[70px]!"/>
  </div>
  <Link className="flex h-60 min-h-60 items-center justify-center max-[992px]:h-[180px] max-[992px]:min-h-[180px] max-[600px]:h-[110px] max-[600px]:min-h-[110px] group-data-[view=grid]/listing:h-[180px] group-data-[view=grid]/listing:min-h-[180px] max-[600px]:group-data-[view=grid]/listing:h-[150px] max-[600px]:group-data-[view=grid]/listing:min-h-[150px]" href={"/urun/"+p.id} aria-label={title}>{image?<Image className="block size-60 max-w-full bg-white object-contain max-[992px]:size-[180px] max-[600px]:size-[110px] group-data-[view=grid]/listing:size-[180px] max-[600px]:group-data-[view=grid]/listing:h-[150px] max-[600px]:group-data-[view=grid]/listing:w-[140px]" src={image.src} width={image.width} height={image.height} alt={title} loading="lazy" unoptimized/>:<PartArt kind={category?.art} className="size-[180px] max-[600px]:size-[110px]"/>}</Link>
  {p.supplier==="demo"&&<small className="block text-center text-[11px] text-muted-foreground">Örnek ürün</small>}
 </div>
 <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_290px] gap-x-3 max-[1358px]:flex max-[1358px]:flex-col max-[992px]:col-start-1 max-[992px]:row-start-1 max-[600px]:pt-11 group-data-[view=grid]/listing:flex group-data-[view=grid]/listing:flex-1 group-data-[view=grid]/listing:flex-col group-data-[view=grid]/listing:gap-0 max-[600px]:group-data-[view=grid]/listing:p-0">
 <div className="min-w-0 max-[1358px]:w-[250px] max-[1358px]:max-w-full max-[600px]:min-h-[65px] max-[600px]:max-w-[calc(100%-120px)] group-data-[view=grid]/listing:w-auto max-[600px]:group-data-[view=grid]/listing:min-h-0 max-[600px]:group-data-[view=grid]/listing:max-w-none">
  <Link className="mb-2 block text-base leading-6 font-medium wrap-anywhere transition-colors hover:text-primary max-[600px]:text-sm max-[600px]:leading-5 group-data-[view=grid]/listing:min-h-12" href={"/urun/"+p.id}>{title}</Link>
  <div className="flex min-h-[30px] flex-wrap items-center gap-2 text-[13px] leading-5 text-muted-foreground max-[600px]:text-[11px] group-data-[view=grid]/listing:flex-nowrap">
   {fitsVehicle?<Badge className="h-auto shrink-0 rounded-[3px] border-0 bg-[#dcf2e6] px-1.5 py-0.5 text-[11px] leading-4 font-medium text-[#1e5e3e] [a]:hover:bg-[#cdebdb]" render={<Link href={"/urun/"+p.id+"#uyumlu-araclar"}/>}>ARACINA UYAR</Badge>
     :details?.vehicleSpecific&&<Badge className="h-auto shrink-0 rounded-[3px] border-0 bg-[#dfe3e8] px-1.5 py-0.5 text-[11px] leading-4 font-medium text-foreground [a]:hover:bg-[#d3d8de]" render={<Link href={"/urun/"+p.id+"#uyumlu-araclar"}/>}>ARACA ÖZEL</Badge>}
   <span className="py-[3px] wrap-anywhere group-data-[view=grid]/listing:min-w-0 group-data-[view=grid]/listing:truncate max-[600px]:group-data-[view=grid]/listing:hidden" title={p.code}>Kod: {p.code}</span>
  </div>
 </div>
 <CardSpecifications specifications={specifications}/>
 <div className="col-start-2 row-span-2 row-start-1 w-[290px] min-w-0 max-[1358px]:max-w-full max-[600px]:w-full group-data-[view=grid]/listing:mt-auto group-data-[view=grid]/listing:flex group-data-[view=grid]/listing:w-full group-data-[view=grid]/listing:flex-col">
  <div className={cn("mt-2 text-2xl leading-7 font-medium text-foreground tabular-nums max-[600px]:text-xl group-data-[view=grid]/listing:order-1 group-data-[view=grid]/listing:mt-4 max-[600px]:group-data-[view=grid]/listing:mt-2 max-[600px]:group-data-[view=grid]/listing:text-base max-[600px]:group-data-[view=grid]/listing:leading-[22px]",p.price_kurus===null&&"text-base leading-6 text-muted-foreground max-[600px]:text-base")}>{price}</div>
  {p.price_kurus!==null&&<div className="mb-4 text-[13px] leading-5 text-muted-foreground group-data-[view=grid]/listing:order-2">KDV dahil <span className="ml-[5px] border-l border-input pl-[5px]">· Kargo hariç</span>{discounted&&<span className="ml-[5px] border-l border-input pl-[5px]"> · Servisine özel fiyat</span>}</div>}
  <p className={cn("mt-4 mb-6 flex items-start gap-2 text-sm leading-5 text-foreground group-data-[view=grid]/listing:order-0 group-data-[view=grid]/listing:mt-0 group-data-[view=grid]/listing:min-h-10 max-[600px]:group-data-[view=grid]/listing:hidden",!p.available&&"text-muted-foreground")}><Image className="shrink-0" src="/media/trodo/icons/calendar-check.svg" width={20} height={20} alt="" unoptimized/>{p.stock_label}</p>
  <PurchaseForm productId={p.id} name={p.name} available={p.available&&p.price_kurus!==null} maxQuantity={p.max_quantity} className="group-data-[view=grid]/listing:order-3 group-data-[view=grid]/listing:mt-4 max-[600px]:group-data-[view=grid]/listing:hidden"/>
  <CompareCheckbox entry={{id:p.id,title,price,specifications}}/>
  <Link className="text-sm leading-5 font-medium text-brand-strong hover:underline group-data-[view=grid]/listing:order-5 max-[600px]:group-data-[view=grid]/listing:mt-4 max-[600px]:group-data-[view=grid]/listing:text-xs max-[600px]:group-data-[view=grid]/listing:leading-[18px]" href="/bilgi/uyumluluk"><Info size={14} className="hidden"/>Güvenlik ve uyumluluk bilgileri</Link>
 </div></div></article>;
}
