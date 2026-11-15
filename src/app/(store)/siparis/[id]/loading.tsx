import { Skeleton } from "@/components/ui/skeleton";

const panel="rounded-2xl border border-border bg-white p-[25px] text-sm max-[600px]:p-5";

export default function Loading() {
  return <section role="status" className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><span className="sr-only">Sipariş yükleniyor</span>
    <div aria-hidden>
      <Skeleton className="mb-2 h-[18px] w-28"/><Skeleton className="mb-5 h-[42px] w-64 max-w-full max-[600px]:h-[35px]"/>
      <Skeleton className="mb-6 h-[52px] w-full rounded-md"/>
      <div className="mb-[45px] grid grid-cols-2 gap-[60px] max-[1000px]:gap-[30px] max-[600px]:grid-cols-1 max-[600px]:gap-5">
        <article className={panel}><Skeleton className="mb-4 h-[34px] w-44"/>{[0,1].map(i=><div key={i} className="grid gap-2 border-b border-border py-4"><Skeleton className="h-5 w-3/4"/><Skeleton className="h-4 w-1/2"/></div>)}
          <Skeleton className="mt-4 h-5 w-40"/><Skeleton className="mt-2 h-5 w-32"/><Skeleton className="mt-4 h-[29px] w-48"/></article>
        <div className="grid content-start gap-3"><article className={panel}><Skeleton className="mb-3 h-[34px] w-48"/><Skeleton className="mb-2 h-4 w-40"/><Skeleton className="mb-2 h-4 w-56 max-w-full"/><Skeleton className="h-4 w-3/4"/></article></div>
      </div>
      <Skeleton className="h-12 w-44"/>
    </div>
  </section>;
}
