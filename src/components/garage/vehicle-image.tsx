import Image from "next/image";
import { CarFront } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VehicleImage as VehicleImageData } from "@/modules/store/vehicle-catalog";

/** The type's side-view picture in a wide frame, or the generic car icon when there is none. */
export function VehicleImage({ image, alt, size = "md", className }: { image?: VehicleImageData | null; alt: string; size?: "sm" | "md"; className?: string }) {
  const frame = size === "sm" ? "h-6 w-16" : "h-10 w-28";
  // Without a picture the icon keeps its original footprint so the text does not move.
  if (!image) return <span className={cn("grid shrink-0 place-items-center", size === "sm" ? "size-6" : "size-8", className)} aria-hidden="true"><CarFront size={size === "sm" ? 24 : 32} /></span>;
  // REPXPERT pictures are wide side views on white: contained, never cropped. The stored copy is already 800 px wide.
  return <span className={cn("block shrink-0 overflow-hidden rounded-[4px] bg-white", frame, className)}>
    <Image src={image.src} alt={alt} width={image.width} height={image.height} unoptimized className="size-full object-contain" />
  </span>;
}
