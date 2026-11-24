import Image from "next/image";
import Link from "next/link";
import { StoreIcon } from "@/components/site/store-icon";
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
   className={cn("category-card",related&&"category-card-related")}>
   <div className="category-card-image">{category.imagePath?<Image className="h-[90px] w-[135px] object-contain" src={category.imagePath} width={135} height={90} alt=""/>:<StoreIcon name="package" size={48}/>}</div>
   <strong className="text-sm font-semibold">{category.name}</strong>
  </Link>)}
 </div>;
}
