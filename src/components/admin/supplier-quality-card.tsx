import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDate, formatNumber } from "@/modules/admin/format";

export type SupplierQuality = {
  uniqueProducts?: number; productRows?: number; missingPrices?: number; duplicateCodes?: number; conflictingCodes?: number;
};
type Metric = "missing-price" | "duplicates" | "conflicts";

/**
 * Data quality of the latest successful run (supplier_imports.quality), the same four figures on every API supplier
 * page. Each problem links to the product tab filtered by the matching `?quality=` value (plus the page's `filters`,
 * e.g. the Başbuğ group or Dinamik brand the run covered); metrics without a filter on that page get no link.
 */
export function SupplierQualityCard({ quality, scope, completedAt, filters = {}, links = ["missing-price", "duplicates", "conflicts"], children }: {
  quality: SupplierQuality | null | undefined;
  /** What the run covered, e.g. "FIAT / MRK" or "Tüm liste". */
  scope?: string;
  completedAt?: Date | null;
  filters?: Record<string, string | undefined>;
  links?: Metric[];
  /** Supplier-specific detail line under the figures. */
  children?: ReactNode;
}) {
  const href = (metric: Metric) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))), quality: metric })}`;
  const metrics = quality ? [
    { label: "Farklı ürün", value: quality.uniqueProducts ?? 0 },
    { label: "Eksik fiyat", value: quality.missingPrices ?? 0, metric: "missing-price" as const, tone: "warning" as const },
    { label: "Tekrarlanan kod", value: quality.duplicateCodes ?? 0, metric: "duplicates" as const, tone: "warning" as const },
    { label: "Çelişkili kod", value: quality.conflictingCodes ?? 0, metric: "conflicts" as const, tone: "error" as const },
  ] : [];
  return <Card>
    <CardHeader>
      <CardTitle><h2>Veri kalitesi</h2></CardTitle>
      <CardDescription>{quality ? `Son başarılı çekim${scope ? ` · ${scope}` : ""} · ${formatDate(completedAt)}` : "Başarılı çekim olmadan kalite ölçülemez."}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {quality ? <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, metric, tone }) => <Card key={label} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle><span className="text-2xl font-semibold tabular-nums">{formatNumber(value)}</span></CardTitle>
              <CardAction>{!tone ? quality.productRows !== undefined && <StatusBadge tone="info">{formatNumber(quality.productRows)} satır</StatusBadge>
                : value ? <StatusBadge tone={tone}>İncele</StatusBadge> : <StatusBadge tone="success">Sorun yok</StatusBadge>}</CardAction>
            </CardHeader>
            {metric && value > 0 && links.includes(metric) && <CardContent>
              <Button variant="link" nativeButton={false} render={<Link data-supplier-tab="products" href={href(metric)}/>}>Kayıtları incele<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
            </CardContent>}
          </Card>)}
        </div>
        {children}
      </> : <Empty><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck/></EmptyMedia><EmptyTitle>Henüz kalite verisi yok</EmptyTitle>
        <EmptyDescription>İlk başarılı çekimden sonra eksik fiyat, tekrarlanan ve çelişkili kodlar burada sayılır.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent>
  </Card>;
}
