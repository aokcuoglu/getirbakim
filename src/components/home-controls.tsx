"use client";

import {Children, useEffect, useState, type ReactNode} from "react";
import Image from "next/image";
import Link from "next/link";
import {Package} from "lucide-react";
import {Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, useCarousel} from "@/components/ui/carousel";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {cn} from "@/lib/utils";
import type {StoreCategory} from "@/modules/store/category-tree";

function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

const arrow = "z-[2] size-9 min-h-0 p-0 border-border bg-white/95 text-foreground hover:bg-white disabled:hidden [&_svg:not([class*='size-'])]:size-[18px]";

/** Arrows + line-style page indicators; reads the surrounding shadcn Carousel. */
function Pager({label, grid}: {label: string; grid?: boolean}) {
  const {api} = useCarousel();
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!api) return;
    const update = () => {setPages(api.scrollSnapList().length); setPage(api.selectedScrollSnap());};
    update();
    api.on("select", update).on("reInit", update);
    return () => {api.off("select", update).off("reInit", update);};
  }, [api]);
  if (pages < 2) return null;
  const position = grid ? "inset-y-auto top-[calc(100%+26px)] my-0 -translate-y-1/2" : "";
  return <>
    <CarouselPrevious aria-label={label+": önceki"} className={cn(arrow, "-left-3 max-md:left-0", position)}/>
    <CarouselNext aria-label={label+": sonraki"} className={cn(arrow, "-right-3 max-md:right-0", position)}/>
    <div className="absolute inset-x-0 top-[calc(100%+20px)] flex justify-center gap-2" aria-label={label+" sayfaları"}>
      {Array.from({length: pages}, (_, index) => <button key={index} type="button" aria-label={label+": "+(index+1)+". sayfa"} aria-current={page===index?"true":undefined} onClick={() => api?.scrollTo(index)}
        className="group h-3 min-h-0 w-8 cursor-pointer rounded-none border-0 bg-transparent px-0 py-[5px]"><span className={cn("block h-0.5 w-full", page===index?"bg-foreground":"bg-input group-hover:bg-muted-foreground")}/></button>)}
    </div>
  </>;
}

const productBasis: Record<number, string> = {3: "min-[48.0625rem]:basis-1/3", 4: "min-[48.0625rem]:basis-1/4", 5: "min-[48.0625rem]:basis-1/5", 6: "min-[48.0625rem]:basis-1/6"};

export function HomeCarousel({children,label,kind="promotions",columns=5}:{children:ReactNode;label:string;kind?:"promotions"|"products";columns?:number}) {
  const slides = Children.toArray(children);
  if (!slides.length) return null;
  const basis = kind==="products" ? cn("basis-1/2", productBasis[columns] ?? "min-[48.0625rem]:basis-1/5") : "basis-full min-[48.0625rem]:basis-1/2";
  return <Carousel opts={{align: "start", slidesToScroll: "auto", containScroll: "trimSnaps"}} aria-label={label} aria-roledescription="slider" className="min-w-0">
    <CarouselContent className="items-stretch">{slides.map((slide, index) => <CarouselItem key={index} className={basis}>{slide}</CarouselItem>)}</CarouselContent>
    <Pager label={label}/>
  </Carousel>;
}

export function HomeGridPager({children,label,kind}:{children:ReactNode;label:string;kind:"makes"|"manufacturers"}) {
  const entries=Children.toArray(children),mobile=useMobile();
  const perPage=mobile?12:kind==="makes"?18:24;
  const pages=Array.from({length:Math.ceil(entries.length/perPage)},(_,page)=>entries.slice(page*perPage,(page+1)*perPage));
  const grid=kind==="makes"?"grid-cols-6 gap-4 max-md:grid-cols-3 max-md:gap-3":"grid-cols-8 gap-x-4 gap-y-[22px] max-md:grid-cols-4 max-md:gap-3";
  return <Carousel key={perPage} aria-label={label} className="min-w-0">
    <CarouselContent>{pages.map((items,page)=><CarouselItem key={page}><div className={cn("grid",grid)}>{items}</div></CarouselItem>)}</CarouselContent>
    <Pager label={label} grid/>
  </Carousel>;
}

export function HomeCategoryTabs({categories}:{categories:StoreCategory[]}) {
  const roots=categories.filter(category=>category.parentId===null);
  const [selected,setSelected]=useState(roots[0]?.id);
  return <section className="mt-[100px] max-md:mt-[76px]" aria-label="Ürün kategorileri">
    <Tabs value={selected} onValueChange={value=>setSelected(value as number)} className="gap-0">
      <TabsList variant="line" activateOnFocus aria-label="Ana kategoriler" className="mb-[42px] flex h-auto w-full justify-start gap-4 overflow-x-auto rounded-none p-0 [scrollbar-width:none] max-md:mb-6 [&::-webkit-scrollbar]:hidden">
        {roots.map(category=><TabsTrigger key={category.id} value={category.id} className="h-8 min-h-0 flex-none rounded-none border-0 px-0 pt-0 pb-3 text-base leading-5 font-medium text-[#54626e] hover:text-foreground data-active:text-foreground max-md:text-sm group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-[3px] after:rounded-[2px] after:bg-brand focus-visible:ring-0 focus-visible:outline-2">{category.name}</TabsTrigger>)}
      </TabsList>
      {roots.map(root=>{
        const children=categories.filter(category=>category.parentId===root.id);
        return <TabsContent key={root.id} value={root.id} className="pb-4">{children.length>0&&<div className="-mx-0.5 grid grid-cols-6 gap-4 max-[68.75rem]:grid-cols-4 max-md:mx-0 max-md:grid-cols-3 max-md:gap-3 max-[37.5rem]:grid-cols-2">
          {children.map(category=><Link key={category.id} href={"/katalog?category="+category.slug} className="flex h-[180px] flex-col items-center justify-center rounded-[4px] border border-[#dfe3e8] bg-white p-6 text-center text-foreground hover:border-brand hover:text-brand max-md:h-40 max-md:px-2 max-md:py-3.5">
            <div className="grid h-[90px] w-[135px] max-w-full shrink-0 place-items-center">{category.imagePath?<Image src={category.imagePath} width={135} height={90} alt="" unoptimized className="h-[90px] w-[135px] object-contain"/>:<Package size={48} aria-hidden="true"/>}</div>
            <strong className="flex h-10 w-full items-center justify-center overflow-hidden text-sm leading-[18px] font-medium">{category.name}</strong>
          </Link>)}
        </div>}</TabsContent>;
      })}
    </Tabs>
  </section>;
}

export function HomeScrollHeader() {
  useEffect(()=>{
    const update=()=>{if(window.scrollY>173)document.body.dataset.homeScrolled="true";else delete document.body.dataset.homeScrolled;};
    update();window.addEventListener("scroll",update,{passive:true});
    return()=>{window.removeEventListener("scroll",update);delete document.body.dataset.homeScrolled;};
  },[]);
  return null;
}
