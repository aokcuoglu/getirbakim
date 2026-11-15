import { Skeleton } from "@/components/ui/skeleton";

/** Instant placeholder for /sepet and /siparis-olustur while the cart lines and prices load (#705). */
export function CartSkeleton({title,label,checkout=false,rows=3}:{title:string;label:string;checkout?:boolean;rows?:number}) {
  return <div className="bg-[#f8f9f9] text-foreground" role="status" aria-live="polite"><span className="sr-only">{label}</span>
    <section className="mx-auto min-h-[550px] w-full max-w-[1350px] px-[15px] pb-12 max-[760px]:px-3" aria-hidden>
      {checkout
        ? <div className="flex items-center justify-between gap-6 py-9 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5 max-[760px]:py-7"><p className="m-0 text-[28px] leading-9 font-semibold tracking-[-0.7px]">{title}</p>
            <div className="flex items-center gap-6 max-[760px]:gap-3">{[0,1,2].map(step=><div key={step} className="flex items-center gap-2"><Skeleton className="size-8 rounded-full"/><Skeleton className="h-4 w-14"/></div>)}</div></div>
        : <><Skeleton className="mt-4 mb-7 h-5 w-36"/><p className="m-0 mb-9 text-[36px] leading-[44px] font-semibold tracking-[-1px] max-[760px]:mb-6 max-[760px]:text-[30px]">{title}</p></>}
      <div className="grid grid-cols-[minmax(0,1.76fr)_minmax(320px,1fr)] items-start gap-4 max-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] max-[760px]:grid-cols-1">
        <div className="rounded-[10px] border border-border bg-card">
          {checkout
            ? <div className="grid gap-5 p-5 max-[760px]:px-4"><Skeleton className="h-7 w-64 max-w-full"/>{Array.from({length:4},(_,field)=><div key={field} className="grid gap-1.5"><Skeleton className="h-4 w-28"/><Skeleton className="h-[52px] w-full"/></div>)}</div>
            : Array.from({length:rows},(_,row)=><div key={row} className="grid grid-cols-[80px_minmax(0,1fr)_64px_90px] items-start gap-6 border-b border-border px-5 py-6 last:border-b-0 max-[1000px]:grid-cols-[60px_minmax(0,1fr)_56px_80px] max-[1000px]:gap-3 max-[1000px]:px-4 max-[760px]:grid-cols-[60px_minmax(0,1fr)_80px]">
                <Skeleton className="h-[100px] w-full"/>
                <div className="grid gap-3"><Skeleton className="h-5 w-4/5"/><Skeleton className="h-4 w-1/3"/><Skeleton className="h-4 w-1/2"/></div>
                <Skeleton className="h-9 w-full max-[760px]:hidden"/>
                <Skeleton className="ml-auto h-5 w-full"/>
              </div>)}
        </div>
        <div className="grid gap-4 rounded-[10px] border border-border bg-card p-5">
          <Skeleton className="h-7 w-40"/><Skeleton className="h-4 w-32"/><Skeleton className="h-16 w-full"/>
          {[0,1].map(line=><div key={line} className="flex justify-between gap-3"><Skeleton className="h-4 w-24"/><Skeleton className="h-4 w-20"/></div>)}
          <Skeleton className="h-[42px] w-full"/>
        </div>
      </div>
    </section>
  </div>;
}
