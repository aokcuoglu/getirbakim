import Link from "next/link";
import Image from "next/image";
import {Info,Gauge} from "lucide-react";
import {PartArtImage} from "@/components/part-art";
import {categories,money,servicePrice,type CatalogProduct as CatalogEntry} from "@/modules/store/catalog";
import type {Account} from "@/modules/auth/session";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {PurchaseForm} from "@/components/purchase-form";
import {ManufacturerBadge} from "@/components/manufacturer-badge";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import {specificationValue} from "@/modules/store/catalog-filters";
import {Badge} from "@/components/ui/badge";
import {cn} from "@/lib/utils";
import "@/app/catalog-card.css";
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
 return <article className="product-card">
 <div className="product-card-media">
  <div className="product-card-labels">
   {brandClass&&<span className={cn("product-card-class",brandClass==="Premium"?"bg-[#d72b2b]":brandClass==="Budget"?"bg-[#f59e0b]":"bg-[#2e7d32]")} title={specificationValue(brandClass)} aria-label={specificationValue(brandClass)}>{brandClass==="Premium"||brandClass==="Budget"?<Image src={"/media/trodo/icons/"+brandClass.toLowerCase()+".svg"} width={16} height={16} alt="" unoptimized/>:<Gauge size={18}/>}</span>}
   <ManufacturerBadge brand={p.brand} logo={logo} className="product-card-maker"/>
  </div>
  <Link className="product-card-picture" href={"/urun/"+p.id} aria-label={title}>{image?<Image className="product-card-image" src={image.src} width={image.width} height={image.height} alt={title} loading="lazy" unoptimized/>:<PartArtImage kind={category?.art} className="product-card-art"/>}</Link>
  {p.supplier==="demo"&&<small className="block text-center text-[11px] text-muted-foreground">Örnek ürün</small>}
 </div>
 <div className="product-card-body">
 <div className="product-card-heading">
  <Link className="product-card-title" href={"/urun/"+p.id}>{title}</Link>
  <div className="product-card-meta">
   {fitsVehicle?<Badge className="h-auto shrink-0 rounded-[3px] border-0 bg-[#dcf2e6] px-1.5 py-0.5 text-[11px] leading-4 font-medium text-[#1e5e3e] [a]:hover:bg-[#cdebdb]" render={<Link href={"/urun/"+p.id+"#uyumlu-araclar"}/>}>ARACINA UYAR</Badge>
     :details?.vehicleSpecific&&<Badge className="h-auto shrink-0 rounded-[3px] border-0 bg-[#dfe3e8] px-1.5 py-0.5 text-[11px] leading-4 font-medium text-foreground [a]:hover:bg-[#d3d8de]" render={<Link href={"/urun/"+p.id+"#uyumlu-araclar"}/>}>ARACA ÖZEL</Badge>}
   <span className="product-card-code" title={p.code}>Kod: {p.code}</span>
  </div>
 </div>
 <CardSpecifications specifications={specifications}/>
 <div className="product-card-buy">
  <div className={cn("product-card-price",p.price_kurus===null&&"text-base leading-6 text-muted-foreground max-[600px]:text-base")}>{price}</div>
  {p.price_kurus!==null&&<div className="product-card-vat">KDV dahil <span className="product-card-note">· Kargo hariç</span>{discounted&&<span className="product-card-note"> · Servisine özel fiyat</span>}</div>}
  <p className={cn("product-card-stock",!p.available&&"text-muted-foreground")}><Image className="shrink-0" src="/media/trodo/icons/calendar-check.svg" width={20} height={20} alt="" unoptimized/>{p.stock_label}</p>
  <PurchaseForm productId={p.offer_id??p.id} name={p.name} available={p.available&&p.price_kurus!==null} maxQuantity={p.max_quantity} className="group-data-[view=grid]/listing:order-3 group-data-[view=grid]/listing:mt-4 max-[600px]:group-data-[view=grid]/listing:hidden"/>
  <CompareCheckbox entry={{id:p.id,title,price,specifications}}/>
  <Link className="product-card-compliance" href="/bilgi/uyumluluk"><Info size={14} className="hidden"/>Güvenlik ve uyumluluk bilgileri</Link>
 </div></div></article>;
}
