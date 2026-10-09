import Image from "next/image";
import Link from "next/link";
import {Package} from "lucide-react";
import type {StoreCategory} from "@/modules/store/category-tree";
export function CategoryCards({categories,basePath="/katalog"}:{categories:StoreCategory[];basePath?:string}){
 if(!categories.length)return null;
 return <div className="category-image-cards">{categories.map(category=><Link href={basePath+"?category="+category.slug} key={category.id}>
  <div>{category.imagePath?<Image src={category.imagePath} width={135} height={90} alt="" unoptimized/>:<Package size={48} aria-hidden="true"/>}</div>
  <strong>{category.name}</strong>
 </Link>)}</div>;
}
