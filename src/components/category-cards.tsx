import Image from "next/image";
import Link from "next/link";
import {Package} from "lucide-react";
import type {StoreCategory} from "@/modules/store/category-tree";
import {cn} from "@/lib/utils";
import {listingPath} from "@/modules/seo/paths";

// "related" is the grey related-categories band at the bottom of the catalog; on a make's or model's listing the cards
// keep the make and model (#673).
export function CategoryCards({categories,makeSlug,modelSlug,variant="default",className}:{categories:StoreCategory[];makeSlug?:string;modelSlug?:string;variant?:"default"|"related";className?:string}){
 if(!categories.length)return null;
 const related=variant==="related";
 return <div className={cn("my-6 grid grid-cols-4 gap-4 max-[600px]:grid-cols-2 max-[600px]:gap-2",related&&"my-0 max-[768px]:grid-cols-2 max-[600px]:gap-4",className)}>
  {categories.map(category=><Link href={listingPath({makeSlug,modelSlug,categorySlug:category.slug})} key={category.id}
   className={cn("flex min-h-[176px] flex-col items-center justify-center gap-3 rounded-[4px] border border-[#e5e7eb] bg-white px-4 py-6 text-center text-sm text-foreground transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",related&&"rounded-md border-border max-[600px]:min-h-[190px]")}>
   <div className="grid h-[90px] w-full place-items-center">{category.imagePath?<Image className="h-[90px] w-[135px] object-contain" src={category.imagePath} width={135} height={90} alt=""/>:<Package size={48} aria-hidden="true"/>}</div>
   <strong className="text-sm font-semibold">{category.name}</strong>
  </Link>)}
 </div>;
}
