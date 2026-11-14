import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Shown inside the workspace shell (the sidebar stays) while a /yonetim page loads: heading, summary cards and a table.
export default function AdminLoading() {
  return <div className="flex flex-col gap-6" role="status" aria-busy="true">
    <span className="sr-only">Sayfa yükleniyor…</span>
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-56"/>
      <Skeleton className="h-4 w-full max-w-md"/>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map(card => <Card key={card} size="sm">
        <CardHeader className="gap-2"><Skeleton className="h-4 w-24"/><Skeleton className="h-6 w-32"/></CardHeader>
        <CardContent><Skeleton className="h-4 w-full"/></CardContent>
      </Card>)}
    </div>
    <Card>
      <CardHeader><Skeleton className="h-5 w-40"/></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map(row => <Skeleton key={row} className="h-8 w-full"/>)}
      </CardContent>
    </Card>
  </div>;
}
