// Listing card rules (#878), pure so both the server card and the tests use them.
import type {Account} from "@/modules/auth/session";

/** A stock label "Stokta · Siparişten sonra tedarikçiden teyit edilir" splits into the status and its note at the first " · ". */
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
