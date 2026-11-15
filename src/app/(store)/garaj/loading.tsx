import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <section role="status" className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><span className="sr-only">Garaj yükleniyor</span>
    <div aria-hidden>
      <Skeleton className="mb-7 h-5 w-40"/>
      <div className="mx-auto grid max-w-[1020px] grid-cols-[1fr_440px] gap-[70px] max-[1000px]:grid-cols-2 max-[1000px]:gap-[35px] max-[600px]:grid-cols-1 max-[600px]:gap-6">
        <div><Skeleton className="mb-2 h-[18px] w-40"/><Skeleton className="mb-5 h-[42px] w-72 max-w-full max-[600px]:h-[35px]"/><Skeleton className="mb-2 h-6 w-full max-w-sm"/><Skeleton className="h-6 w-4/5 max-w-xs"/></div>
        <Card className="gap-0 rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5">
          <Skeleton className="mb-5 h-[34px] w-56"/>
          <div className="grid gap-5">{[0,1,2].map(i=><div key={i} className="grid gap-2"><Skeleton className="h-5 w-20"/><Skeleton className="h-[52px] w-full rounded-lg"/></div>)}<Skeleton className="h-12 w-full rounded-lg"/></div>
        </Card>
      </div>
    </div>
  </section>;
}
