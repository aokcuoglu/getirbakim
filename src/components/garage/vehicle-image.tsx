import Image from "next/image";
import { CarFront } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VehicleImage as VehicleImageData } from "@/modules/store/vehicle-catalog";

/** The type's side-view picture as a full-width stage above its summary, or the generic car icon when there is none. */
export function VehicleHeroImage({ image, alt }: { image?: VehicleImageData | null; alt: string }) {
  // REPXPERT pictures are wide side views, contained and never cropped; the stored copy is already 800 px wide. They are
  // cut out to a transparent background (npm run vehicles:cutout); multiply hides the white of one not cut out yet.
  // Without a picture a short strip keeps the icon.
  return <span className={cn("flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_40%,#fff_0%,#f3f5f6_70%,#e9edef_100%)] px-4", image ? "aspect-[800/287]" : "h-20")}>
    {image
      ? <Image src={image.src} alt={alt} width={image.width} height={image.height} unoptimized className="size-full object-contain mix-blend-multiply" />
      : <CarFront size={40} strokeWidth={1.25} className="text-muted-foreground opacity-60" aria-hidden="true" />}
  </span>;
}
