"use client";

import {Children, useCallback, useEffect, useState, type ReactNode} from "react";
import Image from "next/image";
import Link from "next/link";
import {Package} from "lucide-react";
import {Tabs as TabsPrimitive} from "@base-ui/react/tabs";
import {Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, useCarousel} from "@/components/ui/carousel";
import {Skeleton} from "@/components/ui/skeleton";
import {Tabs, TabsContent} from "@/components/ui/tabs";
import {armOnApproach} from "@/components/home-arming";
import {SlideImages} from "@/components/home-slide-images";
import {TreeStatus} from "@/components/navigation/category-parts";
import {useCategoryTree} from "@/components/navigation/use-category-tree";
import {cn} from "@/lib/utils";
import {categoryPath} from "@/modules/seo/paths";
import {childCategories, type HomeTabCategory} from "@/modules/store/home-rail";

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

/**
 * Slides outside the first page stay in the HTML (links for SEO) but are not rendered
 * (`content-visibility: hidden`), so their lazy images do not compete with the first page.
 * The carousel is armed on the first interaction (pointer, touch, focus, key, click) or when it
 * comes within 200px of the viewport (#1226; the old load + idle auto-arm fetched every
 * carousel's images on a phone before anyone scrolled there); the browser's native lazy loading
 * then takes over. Slides keep their size, so layout does not shift. The ref is a callback ref
 * with cleanup because HomeGridPager remounts its Carousel when the viewport class flips.
 */
function useArmed() {
  const [armed, setArmed] = useState(false);
  const ref = useCallback((node: HTMLDivElement | null) => (node ? armOnApproach(node, () => setArmed(true)) : undefined), []);
  const arm = () => setArmed(true);
  return {armed, ref, handlers: {onPointerEnter: arm, onTouchStart: arm, onFocus: arm, onKeyDown: arm, onClick: arm}};
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
  // Under 769px the arrows drop onto the indicator row (the grid variant always sits there).
  const position = "max-[48.0625rem]:inset-y-auto max-[48.0625rem]:top-[calc(100%+26px)] max-[48.0625rem]:my-0 max-[48.0625rem]:-translate-y-1/2 max-[48.0625rem]:size-11";
  const gridPosition = grid ? "inset-y-auto top-[calc(100%+26px)] my-0 -translate-y-1/2" : "";
  return <>
    <CarouselPrevious aria-label={label+": önceki"} className={cn(arrow, "-left-3 max-md:left-0", position, gridPosition)}/>
    <CarouselNext aria-label={label+": sonraki"} className={cn(arrow, "-right-3 max-md:right-0", position, gridPosition)}/>
    <p className="sr-only" aria-live="polite">{label}: sayfa {page+1} / {pages}</p>
    <div aria-hidden="true" className={cn("absolute inset-x-0 top-[calc(100%+25px)] flex justify-center max-[48.0625rem]:inset-x-14", pages>=8?"gap-1":"gap-2")}>
      {Array.from({length: pages}, (_, index) => <span key={index} className={cn("h-0.5 min-w-0 max-w-8 flex-1", page===index?"bg-foreground":"bg-input")}/>)}
    </div>
  </>;
}

const deferred = "[content-visibility:hidden]";
// `columns` N shows N slides from md up, so defer from slide n+(N+1); below md 2 are visible, defer from n+3.
// `not-min-` is the exact complement of the `min-` basis breakpoint, so the ranges never overlap.
const deferredFrom: Record<number, string> = {
  3: "min-[48.0625rem]:*:nth-[n+4]:[content-visibility:hidden]",
  4: "min-[48.0625rem]:*:nth-[n+5]:[content-visibility:hidden]",
  5: "min-[48.0625rem]:*:nth-[n+6]:[content-visibility:hidden]",
  6: "min-[48.0625rem]:*:nth-[n+7]:[content-visibility:hidden]",
};

const productBasis: Record<number, string> = {3: "min-[48.0625rem]:basis-1/3", 4: "min-[48.0625rem]:basis-1/4", 5: "min-[48.0625rem]:basis-1/5", 6: "min-[48.0625rem]:basis-1/6"};

export function HomeCarousel({children,label,columns=5}:{children:ReactNode;label:string;columns?:number}) {
  const slides = Children.toArray(children);
  const {armed, ref, handlers} = useArmed();
  if (!slides.length) return null;
  const basis = cn("basis-1/2", productBasis[columns] ?? "min-[48.0625rem]:basis-1/5");
  const defer = armed ? "" : cn("not-min-[48.0625rem]:*:nth-[n+3]:[content-visibility:hidden]", deferredFrom[columns] ?? deferredFrom[5]);
  return <Carousel opts={{align: "start", slidesToScroll: "auto", containScroll: "trimSnaps"}} aria-label={label} aria-roledescription="slider" className="min-w-0" ref={ref} {...handlers}>
    <CarouselContent className={cn("items-stretch", defer)}>{slides.map((slide, index) => <CarouselItem key={index} className={basis}><SlideImages.Provider value={armed || index < columns}>{slide}</SlideImages.Provider></CarouselItem>)}</CarouselContent>
    <Pager label={label}/>
  </Carousel>;
}

export function HomeGridPager({children,label,kind}:{children:ReactNode;label:string;kind:"makes"|"manufacturers"}) {
  const entries=Children.toArray(children),mobile=useMobile();
  const perPage=mobile?12:kind==="makes"?18:24;
  const pages=Array.from({length:Math.ceil(entries.length/perPage)},(_,page)=>entries.slice(page*perPage,(page+1)*perPage));
  const grid=kind==="makes"?"grid-cols-6 gap-4 max-md:grid-cols-3 max-md:gap-3":"grid-cols-8 gap-x-4 gap-y-[22px] max-md:grid-cols-4 max-md:gap-3";
  const {armed,ref,handlers}=useArmed();
  return <Carousel key={perPage} aria-label={label} className="min-w-0" ref={ref} {...handlers}>
    <CarouselContent>{pages.map((items,page)=><CarouselItem key={page} className={cn(page>0&&!armed&&deferred)}><SlideImages.Provider value={armed||page===0}><div className={cn("grid",grid)}>{items}</div></SlideImages.Provider></CarouselItem>)}</CarouselContent>
    <Pager label={label} grid/>
  </Carousel>;
}

const tileGrid="-mx-0.5 grid grid-cols-6 gap-4 max-[68.75rem]:grid-cols-4 max-md:mx-0 max-md:grid-cols-3 max-md:gap-3 max-[37.5rem]:grid-cols-2";

function TabTiles({items}:{items:HomeTabCategory[]}) {
  if(!items.length)return null;
  return <div className={tileGrid}>
    {items.map(category=><Link key={category.id} href={categoryPath(category.slug)} className="home-category-tile">
      <div className="home-category-tile-image">{category.imagePath?<Image src={category.imagePath} width={135} height={90} alt="" className="h-[90px] w-[135px] object-contain"/>:<Package size={48} aria-hidden="true"/>}</div>
      <strong className="home-category-tile-name">{category.name}</strong>
    </Link>)}
  </div>;
}

/** Placeholder tiles, as tall as the real ones, while the category tree loads. */
function TabTilesLoading() {
  return <div role="status" aria-busy="true" className={tileGrid}>
    <span className="sr-only">Kategoriler yükleniyor…</span>
    {Array.from({length:12},(_,index)=><div key={index} aria-hidden="true" className="home-category-tile"><Skeleton className="h-[90px] w-[135px] max-w-full"/><Skeleton className="mt-4 h-4 w-24"/></div>)}
  </div>;
}

/**
 * Every root is a tab, but only the first root's tiles come with the page (#1295): Base UI renders the active panel
 * only, so the other roots' tiles were never in the HTML, only in the RSC payload. They come from the category tree the
 * header menu shares (/api/categories, one request per page load), asked for when the tab list is approached or a tab
 * is chosen. Base UI's Tabs.List / Tabs.Tab carry named classes instead of the TabsTrigger class list.
 */
export function HomeCategoryTabs({roots,initial}:{roots:{id:number;name:string}[];initial:HomeTabCategory[]}) {
  const [selected,setSelected]=useState(roots[0]?.id);
  const tree=useCategoryTree();
  const items=selected===roots[0]?.id?initial:tree.categories?childCategories(tree.categories,selected):null;
  const panel=items?<TabTiles items={items}/>:tree.error?<TreeStatus error retry={tree.retry} rows={0} rowClass=""/>:<TabTilesLoading/>;
  return <section className="mt-[100px] max-md:mt-[76px]" aria-label="Ürün kategorileri">
    <Tabs value={selected} onValueChange={value=>{setSelected(value as number);tree.load();}} className="gap-0">
      <TabsPrimitive.List activateOnFocus aria-label="Ana kategoriler" className="home-tabs" onPointerEnter={tree.load} onTouchStart={tree.load} onFocus={tree.load}>
        {roots.map(category=><TabsPrimitive.Tab key={category.id} value={category.id} className="home-tab">{category.name}</TabsPrimitive.Tab>)}
      </TabsPrimitive.List>
      {roots.map(root=><TabsContent key={root.id} value={root.id} className="pb-4">{root.id===selected&&panel}</TabsContent>)}
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
