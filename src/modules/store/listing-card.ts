// Listing card rules (#878), pure so both the server card and the tests use them.
import type {Account} from "@/modules/auth/session";
import type {CatalogProduct} from "./catalog";
import type {CatalogProductImage} from "./product-enrichment";
import type {ManufacturerLogo} from "./manufacturer-logos";
import {money,servicePrice} from "./money";
import {displaySpecifications,translateSpecificationValue,type CardSpecification} from "./specification-translations";
import {campaignEndText,listPrice,saleUntil} from "./best-offer";
import {catalogCardTitle} from "./product-override-display";
import {productPath} from "@/modules/seo/product-path";

/** A stock label "Stokta · Siparişten sonra teyit edilir" splits into the status and its note at the first " · ". */
export function stockLabelParts(label:string):{status:string;note?:string}{
 const at=label.indexOf(" · ");
 return at<0?{status:label}:{status:label.slice(0,at),note:label.slice(at+3)};
}

/**
 * The card's fit badge: "match" when linked to the garage vehicle's engine type; "listed" for a vehicle-specific part
 * while no vehicle could be checked; none when the garage vehicle was checked and the part is not linked to it.
 */
export function cardFitBadge({fitsVehicle,vehicleSpecific,vehicleChecked}:{fitsVehicle:boolean;vehicleSpecific:boolean;vehicleChecked:boolean}):"match"|"listed"|null{
 if(fitsVehicle)return "match";
 if(vehicleChecked)return null;
 return vehicleSpecific?"listed":null;
}

/** DESIGN.md: consumers start in the card grid, approved service accounts in the list. */
export function defaultListingView(account:Pick<Account,"role"|"approved">|null):"list"|"grid"{
 return account?.approved&&account.role==="service"?"list":"grid";
}

/**
 * What a listing card shows, as finished strings (#1212): the client card renders it without dates, number formats or
 * the name dictionary, and the props stay small. Optional fields are left out rather than sent as undefined.
 */
export type ListingCardModel={
 id:string;
 /** The offer the cart adds: a grouped listing's chosen offer, else the product. */
 purchaseId:string;
 name:string;href:string;title:string;code:string;brand:string;
 logo?:ManufacturerLogo;image?:string;art?:string;
 /** The REPXPERT brand class (Premium, Budget, …) and its Turkish label. */
 brandClass?:string;brandClassLabel?:string;
 fit:"match"|"listed"|null;
 card:CardSpecification[];
 /** The formatted price, or the reason there is none. */
 price:string;priceMuted:boolean;
 /** A running campaign's regular price, struck through. */
 regular?:string;
 hasPrice:boolean;
 /** An approved service account's price ("Servisine özel fiyat"). */
 discounted:boolean;
 campaignEnd?:string;
 unavailable:boolean;available:boolean;
 stock:{status:string;note?:string};
 maxQuantity:number;
 demo:boolean;
};
type CardDetails={specifications:[string,string][];card:CardSpecification[];vehicleSpecific:boolean;partNumber:string};

/**
 * The card of a listing row. `discountPercent` is set only for an approved service account (its prices; 0 still marks
 * the price as the service's own). `art` is the category's drawing when there is no image.
 */
export function listingCardModel({product:p,details,image,logo,discountPercent,art,fitsVehicle=false,vehicleChecked=false}:{
 product:CatalogProduct;details?:CardDetails;image?:CatalogProductImage;logo?:ManufacturerLogo;discountPercent?:number;art?:string;
 fitsVehicle?:boolean;vehicleChecked?:boolean;
}):ListingCardModel{
 const discounted=discountPercent!==undefined,discount=discountPercent??0;
 const specifications=details?.specifications??([["Üretici",p.display_brand],...(p.oem?[["OEM",p.oem]]:[])] as [string,string][]);
 // The card's rows: raw key plus Turkish label and value, translated on the server (#700).
 const card=details?.card??displaySpecifications(specifications);
 const brandClass=details?.specifications.find(s=>s[0]==="Brand class")?.[1];
 const priceMuted=Boolean(p.unavailable)||p.price_kurus===null;
 // No supplier sells it now (#475): no price, a link to the product page's "Gelince haber ver" form instead of stock. The
 // view's label says why: "Şu an tedarik edilemiyor", or "Stok bilgisi bekleniyor" for a price-list-only code (#1068).
 const price=p.unavailable?p.stock_label:p.price_kurus===null?"Fiyat bilgisi güncelleniyor":money(servicePrice(p.price_kurus,discount));
 // A running campaign (#580): the regular price struck through, discounted like the price.
 const regular=priceMuted?null:listPrice(p),campaignEnd=regular===null?null:saleUntil(p);
 return {
  id:p.id,purchaseId:p.offer_id??p.id,name:p.name,href:productPath(p),
  // The store brand and part number (#602): an admin's, else the supplier's.
  title:catalogCardTitle(p,details?.partNumber),code:p.display_code,brand:p.display_brand,
  ...(logo&&{logo}),...(image&&{image:image.src}),...(art&&{art}),
  ...(brandClass&&{brandClass,brandClassLabel:translateSpecificationValue(brandClass)}),
  fit:cardFitBadge({fitsVehicle,vehicleSpecific:Boolean(details?.vehicleSpecific),vehicleChecked}),
  card,price,priceMuted,
  ...(regular!==null&&{regular:money(servicePrice(regular,discount))}),
  hasPrice:p.price_kurus!==null,discounted,
  ...(campaignEnd&&{campaignEnd:campaignEndText(campaignEnd)}),
  unavailable:Boolean(p.unavailable),available:p.available,stock:stockLabelParts(p.stock_label),maxQuantity:p.max_quantity,
  demo:p.supplier==="demo",
 };
}
