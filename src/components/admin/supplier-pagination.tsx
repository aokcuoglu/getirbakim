import { Fragment } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { formatNumber } from "@/modules/admin/format";

/** First, last and up to five pages around the current one. */
export function pageWindow(page: number, pages: number) {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  return [...new Set([1, ...Array.from({ length: 5 }, (_, i) => start + i), pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
}

/** Link to `page` keeping every filter and the header sort (`sort`/`dir`) in `keys`. */
export function pageHref(base: string, params: Record<string, string | undefined>, keys: readonly string[], page: number) {
  const query = new URLSearchParams();
  for (const key of keys) if (params[key]) query.set(key, params[key]!);
  query.set("page", String(page));
  return `${base}?${query}`;
}

/**
 * Numbered pagination + "Sayfaya git" for the supplier product tables. `keys` are the page's filter params; `sort` and
 * `dir` are always carried so a header sort survives paging. `capped`: more rows match than the last reachable page
 * shows (SUPPLIER_MAX_PAGE), so the footer asks to narrow the filters.
 */
export function SupplierPagination({ base, params, keys, page, pages, capped = false }: {
  base: string;
  params: Record<string, string | undefined>;
  keys: readonly string[];
  page: number;
  pages: number;
  capped?: boolean;
}) {
  const carried = [...new Set([...keys, "sort", "dir"])];
  const href = (target: number) => pageHref(base, params, carried, target);
  const numbers = pageWindow(page, pages);
  return <div className="flex w-full flex-wrap items-center justify-between gap-3">
    {capped && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>Sonuç çok fazla: yalnız ilk {formatNumber(pages)} sayfa listelenir. Diğer ürünler için arama yapın veya filtreleri daraltın.</AlertDescription></Alert>}
    <span className="text-muted-foreground tabular-nums">Sayfa {formatNumber(page)} / {formatNumber(pages)}{capped && " (sınırlı)"}</span>
    <Pagination className="mx-0 w-auto" aria-label="Ürün sayfaları"><PaginationContent>
      <PaginationItem>{page > 1 ? <Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={href(page - 1)} scroll={false}/>}><ChevronLeft data-icon="inline-start" aria-hidden="true"/><span className="hidden sm:block">Önceki</span></Button>
        : <Button variant="ghost" aria-label="Önceki sayfa" disabled><ChevronLeft data-icon="inline-start" aria-hidden="true"/><span className="hidden sm:block">Önceki</span></Button>}</PaginationItem>
      {numbers.map((n, i) => <Fragment key={n}>
        {i > 0 && n - numbers[i - 1] > 1 && <PaginationItem><PaginationEllipsis/></PaginationItem>}
        <PaginationItem><Button variant={n === page ? "outline" : "ghost"} size="icon" aria-current={n === page ? "page" : undefined} aria-label={`Sayfa ${n}`} nativeButton={false} render={<Link href={href(n)} scroll={false}/>}>{n}</Button></PaginationItem>
      </Fragment>)}
      <PaginationItem>{page < pages ? <Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={href(page + 1)} scroll={false}/>}><span className="hidden sm:block">Sonraki</span><ChevronRight data-icon="inline-end" aria-hidden="true"/></Button>
        : <Button variant="ghost" aria-label="Sonraki sayfa" disabled><span className="hidden sm:block">Sonraki</span><ChevronRight data-icon="inline-end" aria-hidden="true"/></Button>}</PaginationItem>
    </PaginationContent></Pagination>
    <form action={base} className="flex items-center gap-2">
      {carried.filter(key => params[key]).map(key => <input key={key} type="hidden" name={key} value={params[key]}/>)}
      <Label htmlFor="page-jump">Sayfaya git</Label>
      <Input id="page-jump" className="w-20" type="number" name="page" min={1} max={pages} defaultValue={page}/>
      <Button type="submit" variant="outline">Git</Button>
    </form>
  </div>;
}
