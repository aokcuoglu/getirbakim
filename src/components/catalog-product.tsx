import {categories,type CatalogProduct as CatalogEntry} from "@/modules/store/catalog";
import type {Account} from "@/modules/auth/session";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import type {CardSpecification} from "@/modules/store/specification-translations";
import {listingCardModel} from "@/modules/store/listing-card";
import {CatalogProductCard} from "./catalog-product-card";
type Details={specifications:[string,string][];card:CardSpecification[];vehicleSpecific:boolean;partNumber:string};

/**
 * A listing card: prices (an approved service account's discount included), titles and texts are finished here and the
 * client card renders them (#1212). `fitsVehicle`: linked to the garage vehicle's engine type; `vehicleChecked`: the
 * garage vehicle has an engine type to check against.
 */
export function CatalogProduct({product,image,logo,account,details,fitsVehicle=false,vehicleChecked=false}:{product:CatalogEntry;image?:CatalogProductImage;logo?:ManufacturerLogo;account:Account|null;details?:Details;fitsVehicle?:boolean;vehicleChecked?:boolean}){
 const discountPercent=account?.approved&&account.role==="service"?account.discount_percent:undefined;
 const art=categories.find(c=>c.slug===product.category)?.art;
 return <CatalogProductCard model={listingCardModel({product,details,image,logo,discountPercent,art,fitsVehicle,vehicleChecked})}/>;
}
