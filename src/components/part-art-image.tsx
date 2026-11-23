import { cn } from "@/lib/utils";
import { partArtKinds } from "@/components/part-art";
import parts from "../../public/media/part-art/parts.svg";
import brakes from "../../public/media/part-art/brakes.svg";
import filterArt from "../../public/media/part-art/filter.svg";
import oilArt from "../../public/media/part-art/oil.svg";
import wipersArt from "../../public/media/part-art/wipers.svg";
import toolsArt from "../../public/media/part-art/tools.svg";
const art: Record<(typeof partArtKinds)[number], { src: string }> = { parts, brakes, filter: filterArt, oil: oilArt, wipers: wipersArt, tools: toolsArt };
/** The same drawing as a hashed static file (scripts/render-part-art.tsx), for lists with many cards. */
export function PartArtImage({kind="parts",className=""}:{kind?:string;className?:string}) {
 const file=(partArtKinds as readonly string[]).includes(kind)?(kind as (typeof partArtKinds)[number]):"parts";
 // eslint-disable-next-line @next/next/no-img-element -- a static SVG: next/image adds nothing here
 return <img src={art[file].src} width={220} height={150} alt="" aria-hidden="true" loading="lazy" decoding="async" className={cn("block max-w-full",className)}/>;
}
