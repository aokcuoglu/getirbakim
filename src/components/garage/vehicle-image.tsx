import Image from "next/image";
import { CarFront } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VehicleModelImage } from "@/modules/store/vehicle-model-images";

/** The series photograph in a fixed 3:2 frame, or the generic car icon when the series has none. */
export function VehicleImage({ image, alt, size = "md", className }: { image?: VehicleModelImage | null; alt: string; size?: "sm" | "md"; className?: string }) {
  const frame = size === "sm" ? "h-10 w-[60px]" : "h-16 w-24";
  if (!image) return <span className={cn("grid shrink-0 place-items-center", frame, className)} aria-hidden="true"><CarFront size={size === "sm" ? 24 : 32} /></span>;
  // The store never resizes Commons files on the fly: the stored copy is already 480 px wide.
  return <span className={cn("block shrink-0 overflow-hidden rounded-[4px] bg-white", frame, className)}>
    <Image src={image.src} alt={alt} title={image.attribution} width={image.width} height={image.height} unoptimized className="size-full object-cover" />
  </span>;
}

/** Author and licence line required by Creative Commons licences; links to the file page on Commons. */
export function VehicleImageCredit({ image, className }: { image?: VehicleModelImage | null; className?: string }) {
  if (!image) return null;
  return <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer license" className={cn("block truncate text-[11px] leading-4 text-muted-foreground hover:underline", className)}>{image.attribution}</a>;
}
