import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { schedulerLabel, type supplierHealth } from "@/modules/suppliers/health";
import { feedStateLabels, type FeedStatus } from "@/modules/suppliers/data-status";

type Health = Awaited<ReturnType<typeof supplierHealth>>;
/** One import run as the summary shows it: when, how it ended and what it covered (group/brand/list · kind · products). */
export type SupplierRunFact = { at: Date; status: string; scope: string };

const time = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });
const runStatus = (status: string) => status === "succeeded" ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Başarılı</Badge>
  : status === "failed" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Başarısız</Badge>
  : status === "rejected" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>İnceleme gerekli</Badge>
  : status === "running" ? <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Çalışıyor</Badge>
  : <Badge variant="outline">{status}</Badge>;

/**
 * The four summary cards every API supplier page starts with: scheduler, last successful run, last run (any status)
 * and the checkout data source. `feed` adds the overview's data status (same words as the page badge) to the last-success card; `notes` adds
 * supplier-specific lines under a card.
 */
export function SupplierFactCards({ label, health, feed, lastSuccess, lastRun, checkoutMode, checkoutNote, notes = {} }: {
  label: string;
  health: Health | null;
  feed?: FeedStatus | null;
  lastSuccess: SupplierRunFact | null;
  lastRun: SupplierRunFact | null;
  checkoutMode: "snapshot" | "live";
  checkoutNote: string;
  notes?: Partial<Record<"scheduler" | "success" | "run" | "checkout", (string | false | null | undefined)[]>>;
}) {
  const heartbeat = health?.heartbeat;
  const cards: { label: string; value: string; action?: ReactNode; lines: (string | false | null | undefined)[] }[] = [
    { label: "Zamanlayıcı", value: schedulerLabel(health), lines: [
      heartbeat && !heartbeat.finished_at ? `Tur sürüyor · başladı ${time(heartbeat.started_at)}` : `Son kontrol: ${heartbeat?.finished_at ? time(heartbeat.finished_at) : "henüz yok"}`,
      ...(notes.scheduler ?? []),
    ] },
    { label: "Son başarılı çekim", value: lastSuccess ? time(lastSuccess.at) : "Henüz yok", lines: [lastSuccess?.scope ?? "Başarılı çekim kaydı yok",
      feed && `Veriler: ${feedStateLabels[feed.state].toLocaleLowerCase("tr")} · ${new Intl.NumberFormat("tr-TR").format(feed.fresh)} / ${new Intl.NumberFormat("tr-TR").format(feed.tracked)} kapsam güncel`, ...(notes.success ?? [])] },
    { label: "Son çekim", value: lastRun ? time(lastRun.at) : "Henüz yok", action: lastRun && runStatus(lastRun.status), lines: [lastRun?.scope ?? "Çekim kaydı yok", ...(notes.run ?? [])] },
    { label: "Sipariş veri kaynağı", value: checkoutMode === "snapshot" ? "Kayıtlı veriler" : "Canlı API", lines: [checkoutNote, ...(notes.checkout ?? [])] },
  ];
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label={label}>
    {cards.map(card => <Card key={card.label} size="sm">
      <CardHeader>
        <CardDescription>{card.label}</CardDescription>
        <CardTitle className="tabular-nums">{card.value}</CardTitle>
        {card.action && <CardAction>{card.action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-muted-foreground">{card.lines.filter(Boolean).map(line => <p key={line as string}>{line}</p>)}</CardContent>
    </Card>)}
  </div>;
}
