import { Fragment } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { formatNumber } from "@/modules/admin/format";
import { pageWindow } from "@/components/admin/supplier-pagination";

/** Pager of one table of a bulk CSV draft; `href(page)` keeps `taslak`, the list params and the other table's page. */
export function ManualBulkPager({ label, page, pages, total, href }: { label: string; page: number; pages: number; total: number; href: (page: number) => string }) {
  if (pages < 2) return null;
  const numbers = pageWindow(page, pages);
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <span className="text-muted-foreground tabular-nums">Sayfa {formatNumber(page)} / {formatNumber(pages)} · toplam {formatNumber(total)}</span>
    <Pagination className="mx-0 w-auto" aria-label={label}><PaginationContent className="flex-wrap justify-center">
      <PaginationItem>{page > 1 ? <Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={href(page - 1)} scroll={false}/>}><ChevronLeft data-icon="inline-start" aria-hidden="true"/><span className="hidden sm:block">Önceki</span></Button>
        : <Button variant="ghost" aria-label="Önceki sayfa" disabled><ChevronLeft data-icon="inline-start" aria-hidden="true"/><span className="hidden sm:block">Önceki</span></Button>}</PaginationItem>
      {numbers.map((n, i) => <Fragment key={n}>
        {i > 0 && n - numbers[i - 1] > 1 && <PaginationItem><PaginationEllipsis/></PaginationItem>}
        <PaginationItem><Button variant={n === page ? "outline" : "ghost"} size="icon" aria-current={n === page ? "page" : undefined} aria-label={`Sayfa ${n}`} nativeButton={false} render={<Link href={href(n)} scroll={false}/>}>{n}</Button></PaginationItem>
      </Fragment>)}
      <PaginationItem>{page < pages ? <Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={href(page + 1)} scroll={false}/>}><span className="hidden sm:block">Sonraki</span><ChevronRight data-icon="inline-end" aria-hidden="true"/></Button>
        : <Button variant="ghost" aria-label="Sonraki sayfa" disabled><span className="hidden sm:block">Sonraki</span><ChevronRight data-icon="inline-end" aria-hidden="true"/></Button>}</PaginationItem>
    </PaginationContent></Pagination>
  </div>;
}
