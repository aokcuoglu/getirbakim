import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <section role="status" className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><span className="sr-only">Siparişler yükleniyor</span>
    <Skeleton className="mb-5 h-[42px] w-48 max-[600px]:h-[35px]"/>
    <div className="grid gap-3" aria-hidden>{[0,1,2].map(i=><Card key={i} className="gap-0 rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5">
      <Skeleton className="h-[34px] w-56 max-w-full"/><Skeleton className="h-[22px] w-72 max-w-full"/><Skeleton className="h-4 w-32"/></Card>)}</div>
  </section>;
}
