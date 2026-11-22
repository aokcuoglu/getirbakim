import Image from "next/image";
import { ImageOff } from "lucide-react";
import { ItemMedia } from "@/components/ui/item";

/**
 * A shared automatic image's thumbnail (#1176): a blocked image through the admin-only preview route, a shown one
 * through the public media route, anything else as an icon ("no preview" for a blocked image missing here). `unoptimized` keeps the bytes out of the
 * /_next/image cache.
 */
export function SharedImageThumb({ imageId, blocked, shown, alt, size }: {
  imageId: string | null; blocked: boolean; shown: boolean; alt: string; size: "sm" | "lg";
}) {
  const pixels = size === "lg" ? 160 : 64;
  const src = imageId && blocked ? `/api/admin/product-media/${imageId}` : imageId && shown ? `/api/product-media/${imageId}` : null;
  return <ItemMedia variant="image" className={size === "lg" ? "size-40" : "size-16"}>{src
    ? <Image src={src} alt={alt} width={pixels} height={pixels} unoptimized/>
    : <ImageOff className="text-muted-foreground" role="img" aria-label={blocked ? "Önizleme yok" : "Mağazada gösterilmiyor"}/>}</ItemMedia>;
}
