import Image from "next/image";
import Link from "next/link";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import {cn} from "@/lib/utils";

// With `href` (the manufacturer page, #660) the badge is a link; it takes pointer events back from a wrapper that drops them.
// The link shows hover and focus, and a pseudo-element grows its hit area to at least 44px without changing its size.
// The badge sits beside the gallery, not inside it: a click on it never reaches the gallery.
const linkClass = "relative cursor-pointer pointer-events-auto transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-x-1 after:-inset-y-1.5";

export function ManufacturerBadge({brand,logo,className,href}: {brand:string;logo?:ManufacturerLogo;className?:string;href?:string}) {
  const content = logo
    ? <Image src={logo.src} alt={brand} title={brand} width={logo.width} height={logo.height}
      style={{width:84,height:28,objectFit:"contain"}} loading="lazy" unoptimized/>
    : brand;
  return href
    ? <Link href={href} prefetch={false} aria-label={`${brand} ürünleri`} className={cn(className,linkClass)}>{content}</Link>
    : <span className={className}>{content}</span>;
}
