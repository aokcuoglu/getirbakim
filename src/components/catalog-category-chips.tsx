import Link from "next/link";
import type {StoreCategory} from "@/modules/store/category-tree";
import {listingPath} from "@/modules/seo/paths";

// The phone's sub-categories (#878): one row of chips scrolled sideways instead of the category cards, which take the
// screen above the products. From 768px the cards (CategoryCards) show instead.
export function CatalogCategoryChips({categories,makeSlug,modelSlug}:{categories:StoreCategory[];makeSlug?:string;modelSlug?:string}){
 if(!categories.length)return null;
 return <nav aria-label="Alt kategoriler" className="mb-4 min-[768px]:hidden">
  <ul className="-mx-[15px] flex snap-x gap-2 overflow-x-auto px-[15px] py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
   {categories.map(category=><li key={category.id} className="shrink-0 snap-start">
    <Link className="flex min-h-11 items-center rounded-full border border-border bg-white px-4 text-sm whitespace-nowrap text-foreground transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
     href={listingPath({makeSlug,modelSlug,categorySlug:category.slug})}>{category.name}</Link>
   </li>)}
  </ul>
 </nav>;
}
