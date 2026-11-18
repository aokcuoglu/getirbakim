import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <section role="status" className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><span className="sr-only">Adresler yükleniyor</span>
    <div aria-hidden>
      <Skeleton className="mb-7 h-8 w-40"/>
      <div className="mx-auto grid max-w-[1120px] grid-cols-[minmax(0,1fr)_440px] gap-[56px] max-[1000px]:grid-cols-2 max-[1000px]:gap-[32px] max-[600px]:grid-cols-1 max-[600px]:gap-6">
        <div><Skeleton className="mb-2 h-[18px] w-40"/><Skeleton className="mb-3 h-[42px] w-56 max-w-full max-[600px]:h-[35px]"/><Skeleton className="mb-6 h-12 w-full max-w-md"/>
          <div className="grid gap-4">{[0,1].map(i=><Skeleton key={i} className="h-40 w-full rounded-2xl"/>)}</div></div>
        <Card className="gap-0 rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5">
          <Skeleton className="mb-4 h-[34px] w-48"/>
          <div className="grid gap-4">{[0,1,2,3].map(i=><div key={i} className="grid gap-2"><Skeleton className="h-5 w-24"/><Skeleton className="h-[52px] w-full rounded-[5px]"/></div>)}<Skeleton className="h-12 w-full rounded-lg"/></div>
        </Card>
      </div>
    </div>
  </section>;
}
