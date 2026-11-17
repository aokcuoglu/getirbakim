import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { cartBarClass } from "@/components/cart-action-bar";
import { checkoutStepClass, checkoutStepsClass } from "@/components/checkout-steps";

function FieldSkeleton({control="h-[52px]"}:{control?:string}) {
  return <div className="grid gap-1.5"><Skeleton className="h-5 w-28"/><Skeleton className={cn("w-full",control)}/></div>;
}

/** Instant placeholder for /sepet and /siparis-olustur while the cart lines and prices load (#705). */
export function CartSkeleton({title,label,checkout=false,rows=3}:{title:string;label:string;checkout?:boolean;rows?:number}) {
  return <div className="bg-[#f8f9f9] text-foreground" role="status"><span className="sr-only">{label}</span>
    <section className="mx-auto min-h-[550px] w-full max-w-[1350px] px-[15px] pb-12 max-[760px]:px-3" aria-hidden>
      {checkout
        ? <div className="flex items-center justify-between gap-6 py-9 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5 max-[760px]:py-7"><p className="m-0 text-[28px] leading-9 font-semibold tracking-[-0.7px]">{title}</p>
            <ol className={checkoutStepsClass}>{[0,1,2].map(item=><li key={item} className={checkoutStepClass}><Skeleton className="size-8 rounded-full max-[380px]:size-6"/><Skeleton className="h-4 w-14"/></li>)}</ol></div>
        : <><Skeleton className="mt-4 mb-7 h-5 w-36"/>
            <div className="mb-9 flex items-center gap-6 max-[760px]:mb-6 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-2"><p className="m-0 text-[36px] leading-[44px] font-semibold tracking-[-1px] max-[760px]:text-[30px]">{title}</p><Skeleton className="h-5 w-40"/></div></>}
      <div className="grid grid-cols-[minmax(0,1.76fr)_minmax(320px,1fr)] items-start gap-4 max-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] max-[760px]:grid-cols-1">
        {checkout && <Skeleton className="h-[50px] w-full rounded-[10px] min-[761px]:hidden"/>}
        {checkout
          ? <div className="rounded-[10px] border border-border bg-card p-5 max-[760px]:px-4">
              <Skeleton className="mb-2 h-7 w-72 max-w-full"/><Skeleton className="mb-7 h-5 w-56 max-w-full"/>
              <div className="grid gap-4">
                <FieldSkeleton/><FieldSkeleton/><FieldSkeleton/>
                <FieldSkeleton control="h-24"/><FieldSkeleton control="h-20"/>
                <div className="flex items-start gap-2.5"><Skeleton className="my-0.5 size-5 shrink-0"/><div className="grid w-full gap-2"><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-2/3"/></div></div>
                <Skeleton className="mt-2 h-12 w-full"/>
              </div>
              <Skeleton className="mt-[18px] mb-6 h-4 w-80 max-w-full"/><Skeleton className="h-5 w-24"/>
            </div>
          : <div className="rounded-[10px] border border-border bg-card">
              <div className="grid grid-cols-[1fr_64px_90px] gap-6 border-b border-border px-5 py-[18px] max-[1000px]:grid-cols-[1fr_56px_80px] max-[1000px]:gap-3 max-[1000px]:px-4 max-[760px]:hidden"><Skeleton className="h-5 w-12"/><Skeleton className="h-5 w-10"/><Skeleton className="ml-auto h-5 w-12"/></div>
              {Array.from({length:rows},(_,row)=><div key={row} className="grid grid-cols-[80px_minmax(0,1fr)_64px_90px] items-start gap-6 border-b border-border px-5 py-6 last:border-b-0 max-[1000px]:grid-cols-[60px_minmax(0,1fr)_56px_80px] max-[1000px]:gap-3 max-[1000px]:px-4 max-[1000px]:py-5 max-[760px]:grid-cols-[60px_minmax(0,1fr)_80px]">
                <Skeleton className="mt-2 h-[100px] w-full max-[760px]:row-span-2"/>
                <div className="grid gap-3 max-[760px]:col-span-2"><Skeleton className="h-5 w-4/5"/><Skeleton className="h-4 w-1/3"/><Skeleton className="h-4 w-1/2"/><Skeleton className="h-11 w-14"/></div>
                <Skeleton className="h-9 w-full max-[760px]:col-start-2"/>
                <Skeleton className="mt-2 ml-auto h-5 w-full max-[760px]:col-start-3 max-[760px]:row-start-2"/>
              </div>)}
            </div>}
        <div className={cn("rounded-[10px] border border-border bg-card p-5",checkout ? "max-[760px]:hidden" : "max-[760px]:mt-2")}>
          <Skeleton className="h-7 w-40"/><Skeleton className="mt-1 mb-4 h-4 w-32"/>
          <div className="flex items-center gap-4 border-y border-border py-4"><Skeleton className="size-6 shrink-0"/><div className="grid w-full gap-2"><Skeleton className="h-5 w-44"/><Skeleton className="h-4 w-56 max-w-full"/></div></div>
          <div className="grid gap-2.5 border-b border-border py-4">{[0,1].map(line=><div key={line} className="flex justify-between gap-3"><Skeleton className="h-5 w-24"/><Skeleton className="h-5 w-20"/></div>)}</div>
          <div className="mt-5 mb-4 flex justify-between gap-3"><Skeleton className="h-6 w-16"/><Skeleton className="h-6 w-24"/></div>
          {!checkout && <div className="grid gap-4"><Skeleton className="h-11 w-full max-[760px]:hidden"/><Skeleton className="h-11 w-full max-[760px]:hidden"/></div>}
        </div>
      </div>
      {!checkout && <div className={cartBarClass}><Skeleton className="h-[60px] w-24"/><Skeleton className="h-12 flex-1"/></div>}
    </section>
  </div>;
}
