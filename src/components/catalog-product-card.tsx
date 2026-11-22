"use client";
import Link from "next/link";
import Image from "next/image";
import {Gauge,BellRing} from "lucide-react";
import {PartArtImage} from "@/components/part-art-image";
import {PurchaseForm} from "@/components/purchase-form";
import {ManufacturerBadge} from "@/components/manufacturer-badge";
import {cn} from "@/lib/utils";
import type {ListingCardModel} from "@/modules/store/listing-card";
import {CardSpecifications,CompareCheckbox} from "./catalog-card-controls";

// Rendered inside CatalogResults (`group/listing`, data-view="list"|"grid"): every `group-data-[view=grid]/listing:` class is the grid layout.
// A client view of a finished model (#1212): its markup goes out once as HTML instead of twice (HTML and the RSC payload).
export function CatalogProductCard({model:m}:{model:ListingCardModel}){
 return <article className="product-card">
 <div className="product-card-media">
  <div className="product-card-labels">
   {m.brandClass&&<span className={cn("product-card-class",m.brandClass==="Premium"?"bg-[#d72b2b]":m.brandClass==="Budget"?"bg-[#f59e0b]":"bg-[#2e7d32]")} title={m.brandClassLabel} aria-label={"Marka sınıfı: "+m.brandClassLabel}>{m.brandClass==="Premium"||m.brandClass==="Budget"?<Image src={"/media/site/icons/"+m.brandClass.toLowerCase()+".svg"} width={16} height={16} alt="" unoptimized/>:<Gauge size={18}/>}</span>}
   <ManufacturerBadge brand={m.brand} logo={m.logo} className="product-card-maker"/>
  </div>
  {/* The title link is the card's one link for assistive technology and the keyboard; the picture repeats it for the pointer. */}
  <Link className="product-card-picture" href={m.href} aria-hidden="true" tabIndex={-1}>{m.image?<Image className="product-card-image" src={m.image} width={240} height={240} alt="" loading="lazy"/>:<PartArtImage kind={m.art} className="product-card-art"/>}</Link>
  {m.demo&&<small className="block text-center text-[11px] text-muted-foreground">Örnek ürün</small>}
 </div>
 <div className="product-card-body">
 <div className="product-card-heading">
  <Link className="product-card-title" href={m.href} title={m.title}>{m.title}</Link>
  <div className="product-card-meta">
   {m.fit==="match"?<Link data-slot="badge" data-variant="default" className="product-card-fit product-card-fit-match" href={m.href+"#uyumlu-araclar"}>ARACINA UYAR</Link>
     :m.fit==="listed"&&<Link data-slot="badge" data-variant="default" className="product-card-fit product-card-fit-vehicle" href={m.href+"#uyumlu-araclar"}>ARAÇ LİSTESİ</Link>}
   <span className="product-card-code" title={m.code}>Kod: {m.code}</span>
  </div>
 </div>
 <CardSpecifications card={m.card}/>
 <div className="product-card-buy">
  <div className={cn("product-card-price",m.priceMuted&&"text-base leading-6 text-muted-foreground max-[600px]:text-base")}>{m.price}{m.regular!==undefined&&<s className="ml-2 text-sm font-normal text-muted-foreground"><span className="sr-only">Önceki fiyat: </span>{m.regular}</s>}</div>
  {m.hasPrice&&<div className="product-card-vat">KDV dahil <span className="product-card-note">· Kargo hariç</span>{m.discounted&&<span className="product-card-note"> · Servisine özel fiyat</span>}{m.campaignEnd&&<span className="block">Kampanya {m.campaignEnd} tarihine kadar</span>}</div>}
  {m.unavailable?<Link className="product-card-stock font-medium text-[#0065c3] hover:underline" href={m.href+"#haber-ver"}><BellRing size={18} className="shrink-0"/>Gelince haber ver</Link>
   :<p className={cn("product-card-stock product-card-stock-dated",!m.available&&"text-muted-foreground")}><span className="min-w-0"><span className="product-card-stock-status">{m.stock.status}</span>{m.stock.note&&<span className="product-card-stock-note">{m.stock.note}</span>}</span></p>}
  <PurchaseForm productId={m.purchaseId} name={m.name} available={m.available&&m.hasPrice} maxQuantity={m.maxQuantity} className="product-card-buyform"/>
  <CompareCheckbox entry={{id:m.id,price:m.price,card:m.card}}/>
  <Link className="product-card-compliance" href="/bilgi/uyumluluk"><span className="product-card-compliance-full">Güvenlik ve uyumluluk bilgileri</span><span className="product-card-compliance-short">Güvenlik bilgileri</span></Link>
 </div></div></article>;
}
