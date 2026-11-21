import Image from "next/image";
import {Package} from "lucide-react";
import type {StoreCategory} from "@/modules/store/category-tree";
import {Skeleton} from "@/components/ui/skeleton";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import { storeButton } from "@/components/store-button";

/** Pieces shared by the desktop mega menu (category-menu.tsx) and the phone/tablet sheet (category-sheet.tsx). */
export const reset="min-h-0 rounded-none border-0 bg-transparent p-0 font-[inherit] text-inherit hover:bg-transparent";
export const sheetRow="flex w-full items-center gap-3 text-left text-foreground hover:bg-[#f4f5f6] hover:text-brand [&>svg:last-child]:ml-auto [&>svg:last-child]:shrink-0";

/** The tree's error (with a retry when the request failed) or, while it loads, placeholder rows as tall as the real ones. */
export function TreeStatus({error,missing,retry,rows,rowClass}:{error:boolean;missing?:boolean;retry:()=>void;rows:number;rowClass:string}){
 if(error||missing)return <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6 text-sm leading-5 text-foreground">
  <p>{missing?"Bu kategori bulunamadı.":"Kategoriler yüklenemedi."}</p>
  {error&&<Button type="button" variant="outline" onClick={retry} className={storeButton({intent:"outline",size:"md"})}>Tekrar dene</Button>}
 </div>;
 return <div role="status" aria-busy="true"><span className="sr-only">Kategoriler yükleniyor…</span>{Array.from({length:rows},(_,index)=><div key={index} aria-hidden="true" className={cn("flex items-center gap-3 px-4",rowClass)}><Skeleton className="h-[30px] w-[45px] shrink-0"/><Skeleton className="h-4 flex-1"/></div>)}</div>;
}

export function CategoryThumb({category}:{category:StoreCategory}){
 return category.imagePath?<Image src={category.imagePath} width={45} height={30} alt="" className="h-[30px] w-[45px] shrink-0 object-contain"/>:<Package className="w-[45px] shrink-0 text-[#9ca3af]" size={30} aria-hidden="true"/>;
}
