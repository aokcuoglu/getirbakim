import Image from "next/image";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";

export function ManufacturerBadge({brand,logo,className}: {brand:string;logo?:ManufacturerLogo;className?:string}) {
  return <span className={className}>{logo
    ? <Image src={logo.src} alt={brand} title={brand} width={logo.width} height={logo.height}
      style={{width:84,height:28,objectFit:"contain"}} loading="lazy" unoptimized/>
    : brand}</span>;
}
