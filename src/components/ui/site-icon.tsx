import Image from "next/image";
const paths={search:"search.svg",profile:"profile.svg",garage:"garage-v2.svg",cart:"cart.svg",help:"help-red.svg",truck:"truck.svg",check:"success.svg",car:"car-white.svg",edit:"edit-white.svg",chevron:"chevron-small.svg",clipboard:"clipboard.svg",lens:"search-lens.svg",support:"user-check-rounded.svg"};
export function SiteIcon({name,size=20,className=""}:{name:keyof typeof paths;size?:number;className?:string}) {
 return <Image className={`site-icon ${className}`} src={`/media/trodo/images/${paths[name]}`} width={size} height={size} style={{width:size,height:size}} alt="" aria-hidden unoptimized/>;
}
