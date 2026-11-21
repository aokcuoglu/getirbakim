import Link from "next/link";
import type {StoreCategory} from "@/modules/store/category-tree";
import {listingPath} from "@/modules/seo/paths";

// The phone's sub-categories (#878): one row of chips scrolled sideways instead of the category cards, which take the
// screen above the products. From 768px the cards (CategoryCards) show instead.
// The row fades out at the right edge to say it scrolls; its vertical padding keeps the focus outline unclipped.
export function CatalogCategoryChips({categories,makeSlug,modelSlug}:{categories:StoreCategory[];makeSlug?:string;modelSlug?:string}){
 if(!categories.length)return null;
 return <nav aria-label="Alt kategoriler" className="mb-4 min-[768px]:hidden">
  <ul className="-mx-[15px] flex snap-x scroll-px-[15px] gap-2 overflow-x-auto py-1.5 pr-8 pl-[15px] [mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
   {categories.map(category=><li key={category.id} className="shrink-0 snap-start">
    <Link className="category-chip"
     href={listingPath({makeSlug,modelSlug,categorySlug:category.slug})}>{category.name}</Link>
   </li>)}
  </ul>
 </nav>;
}
