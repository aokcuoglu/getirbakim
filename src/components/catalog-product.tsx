import Link from "next/link";
import Image from "next/image";
import {Gauge,BellRing} from "lucide-react";
import {PartArtImage} from "@/components/part-art-image";
import {categories,money,servicePrice,type CatalogProduct as CatalogEntry} from "@/modules/store/catalog";
import type {Account} from "@/modules/auth/session";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {PurchaseForm} from "@/components/purchase-form";
import {ManufacturerBadge} from "@/components/manufacturer-badge";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import {displaySpecifications,translateSpecificationValue,type CardSpecification} from "@/modules/store/specification-translations";
import {cn} from "@/lib/utils";
import {campaignEndText,listPrice,saleUntil} from "@/modules/store/best-offer";
import {CardSpecifications,CompareCheckbox} from "./catalog-card-controls";
import {productPath} from "@/modules/seo/product-path";
import {catalogCardTitle} from "@/modules/store/product-override-display";
import {cardFitBadge,stockLabelParts} from "@/modules/store/listing-card";
type Details={specifications:[string,string][];card:CardSpecification[];vehicleSpecific:boolean;partNumber:string};

// Rendered inside CatalogResults (`group/listing`, data-view="list"|"grid"): every `group-data-[view=grid]/listing:` class is the grid layout.
/** `fitsVehicle`: linked to the garage vehicle's engine type; `vehicleChecked`: the garage vehicle has an engine type to check against. */
export function CatalogProduct({product:p,image,logo,account,details,fitsVehicle=false,vehicleChecked=false}:{product:CatalogEntry;image?:CatalogProductImage;logo?:ManufacturerLogo;account:Account|null;details?:Details;fitsVehicle?:boolean;vehicleChecked?:boolean}){
 const discounted=Boolean(account?.approved&&account.role==="service"),category=categories.find(c=>c.slug===p.category);
 // The store brand and part number (#602): an admin's, else the supplier's.
 const title=catalogCardTitle(p,details?.partNumber),href=productPath(p);
 const specifications=details?.specifications??([["Üretici",p.display_brand],...(p.oem?[["OEM",p.oem]]:[])] as [string,string][]);
 // The card's rows: raw key plus Turkish label and value, translated on the server (#700).
 const card=details?.card??displaySpecifications(specifications);
 const brandClass=details?.specifications.find(s=>s[0]==="Brand class")?.[1];
 // No supplier sells it now (#475): no price, a link to the product page's "Gelince haber ver" form instead of stock. The
 // view's label says why: "Şu an tedarik edilemiyor", or "Stok bilgisi bekleniyor" for a price-list-only code (#1068).
 const price=p.unavailable?p.stock_label:p.price_kurus===null?"Fiyat bilgisi güncelleniyor":money(servicePrice(p.price_kurus,discounted?account!.discount_percent:0));
 // A running campaign (#580): the regular price struck through, discounted like the price.
 const fit=cardFitBadge({fitsVehicle,vehicleSpecific:Boolean(details?.vehicleSpecific),vehicleChecked}),stock=stockLabelParts(p.stock_label);
 const regular=p.unavailable||p.price_kurus===null?null:listPrice(p),campaignEnd=regular===null?null:saleUntil(p);
 return <article className="product-card">
 <div className="product-card-media">
  <div className="product-card-labels">
   {brandClass&&<span className={cn("product-card-class",brandClass==="Premium"?"bg-[#d72b2b]":brandClass==="Budget"?"bg-[#f59e0b]":"bg-[#2e7d32]")} title={translateSpecificationValue(brandClass)} aria-label={"Marka sınıfı: "+translateSpecificationValue(brandClass)}>{brandClass==="Premium"||brandClass==="Budget"?<Image src={"/media/site/icons/"+brandClass.toLowerCase()+".svg"} width={16} height={16} alt="" unoptimized/>:<Gauge size={18}/>}</span>}
   <ManufacturerBadge brand={p.display_brand} logo={logo} className="product-card-maker"/>
  </div>
  {/* The title link is the card's one link for assistive technology and the keyboard; the picture repeats it for the pointer. */}
  <Link className="product-card-picture" href={href} aria-hidden="true" tabIndex={-1}>{image?<Image className="product-card-image" src={image.src} width={240} height={240} alt="" loading="lazy"/>:<PartArtImage kind={category?.art} className="product-card-art"/>}</Link>
  {p.supplier==="demo"&&<small className="block text-center text-[11px] text-muted-foreground">Örnek ürün</small>}
 </div>
 <div className="product-card-body">
 <div className="product-card-heading">
  <Link className="product-card-title" href={href} title={title}>{title}</Link>
  <div className="product-card-meta">
   {fit==="match"?<Link data-slot="badge" data-variant="default" className="product-card-fit product-card-fit-match" href={href+"#uyumlu-araclar"}>ARACINA UYAR</Link>
     :fit==="listed"&&<Link data-slot="badge" data-variant="default" className="product-card-fit product-card-fit-vehicle" href={href+"#uyumlu-araclar"}>ARAÇ LİSTESİ</Link>}
   <span className="product-card-code" title={p.display_code}>Kod: {p.display_code}</span>
  </div>
 </div>
 <CardSpecifications card={card}/>
 <div className="product-card-buy">
  <div className={cn("product-card-price",(p.unavailable||p.price_kurus===null)&&"text-base leading-6 text-muted-foreground max-[600px]:text-base")}>{price}{regular!==null&&<s className="ml-2 text-sm font-normal text-muted-foreground"><span className="sr-only">Önceki fiyat: </span>{money(servicePrice(regular,discounted?account!.discount_percent:0))}</s>}</div>
  {p.price_kurus!==null&&<div className="product-card-vat">KDV dahil <span className="product-card-note">· Kargo hariç</span>{discounted&&<span className="product-card-note"> · Servisine özel fiyat</span>}{campaignEnd&&<span className="block">Kampanya {campaignEndText(campaignEnd)} tarihine kadar</span>}</div>}
  {p.unavailable?<Link className="product-card-stock font-medium text-[#0065c3] hover:underline" href={href+"#haber-ver"}><BellRing size={18} className="shrink-0"/>Gelince haber ver</Link>
   :<p className={cn("product-card-stock product-card-stock-dated",!p.available&&"text-muted-foreground")}><span className="min-w-0"><span className="product-card-stock-status">{stock.status}</span>{stock.note&&<span className="product-card-stock-note">{stock.note}</span>}</span></p>}
  <PurchaseForm productId={p.offer_id??p.id} name={p.name} available={p.available&&p.price_kurus!==null} maxQuantity={p.max_quantity} className="product-card-buyform"/>
  <CompareCheckbox entry={{id:p.id,price,card}}/>
  <Link className="product-card-compliance" href="/bilgi/uyumluluk"><span className="product-card-compliance-full">Güvenlik ve uyumluluk bilgileri</span><span className="product-card-compliance-short">Güvenlik bilgileri</span></Link>
 </div></div></article>;
}
