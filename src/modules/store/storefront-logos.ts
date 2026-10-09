import logoAssets from "../../../data/brand-logos.json";
import {manufacturerBrandKey} from "./enrichment-contract";

export type StorefrontLogo = {src:string; width:number; height:number};

const vehicleKey = (name:string) => name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const vehicles = new Map(Object.entries(logoAssets.vehicles).map(([name,logo]) => [vehicleKey(name),logo]));
const manufacturers = new Map(Object.entries(logoAssets.manufacturers).map(([name,logo]) => [manufacturerBrandKey(name),logo]));

function versionedLogo(logo:StorefrontLogo & {sha256:string}):StorefrontLogo {
  return {src:`${logo.src}?v=${logo.sha256.slice(0,12)}`,width:logo.width,height:logo.height};
}

export function getVehicleLogo(name:string) {
  const logo = vehicles.get(vehicleKey(name));
  return logo ? versionedLogo(logo) : undefined;
}

export function getStaticManufacturerLogo(name:string) {
  const logo = manufacturers.get(manufacturerBrandKey(name));
  return logo ? versionedLogo(logo) : undefined;
}
