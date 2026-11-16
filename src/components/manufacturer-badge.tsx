import Image from "next/image";
import Link from "next/link";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import {cn} from "@/lib/utils";

// With `href` (the manufacturer page, #660) the badge is a link; it takes pointer events back from a wrapper that drops them.
export function ManufacturerBadge({brand,logo,className,href}: {brand:string;logo?:ManufacturerLogo;className?:string;href?:string}) {
  const content = logo
    ? <Image src={logo.src} alt={brand} title={brand} width={logo.width} height={logo.height}
      style={{width:84,height:28,objectFit:"contain"}} loading="lazy" unoptimized/>
    : brand;
  return href
    ? <Link href={href} prefetch={false} aria-label={`${brand} ürünleri`} className={cn(className,"pointer-events-auto")}>{content}</Link>
    : <span className={className}>{content}</span>;
}
