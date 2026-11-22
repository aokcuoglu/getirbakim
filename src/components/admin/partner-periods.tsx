import { Download, Lock, LockOpen } from "lucide-react";
import type { adminPartnerPeriods } from "@/modules/admin/partners";
import { periodLabel } from "@/modules/admin/partner-input";
import { formatDateTime } from "@/modules/admin/format";
import { PartnerPeriodCloseDialog, PartnerPeriodReopenDialog } from "@/components/admin/partner-period-dialogs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statementHref = (partner: string, period: string) => `/yonetim/partnerler/ekstre?partner=${encodeURIComponent(partner)}&donem=${period}`;

/**
 * /yonetim/partnerler period close cards (#1200): per partner the last three months and every other closed one, each
 * with its statement CSV and close or reopen; a form for any of the last 24 months' statements; the close history.
 */
export function PartnerPeriods({ periods }: { periods: Awaited<ReturnType<typeof adminPartnerPeriods>> }) {
  const current = periods.periods[0];
  const partners = [...new Set(periods.rows.map(row => row.partner))];
  return <>
    <Card>
      <CardHeader>
        <CardTitle>Dönem kapanışı ve ekstre</CardTitle>
        <CardDescription>Ay sonunda partnerin dönemi kapatılır: kapalı aya tarihli faturalar işaretlenemez, düzeltilemez ya da geri alınamaz; ödeme tarihi kapalı ayda olan tahsilat girilemez ya da iptal edilemez. Tahsilat için yalnız ödeme tarihi önemlidir, faturanın ayı değil. Kapalı dönem gerekçeyle yeniden açılabilir. Ekstre (CSV), ayın faturalarını, o ay ödenen tahsilatları (iptal edilenler dahil) ve ay başı ile ay sonu açık bakiyeyi içerir; eksi bakiye partnerin peşin ödemesidir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {periods.rows.length > 0 && <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Partner</TableHead><TableHead>Dönem</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{periods.rows.map(row => {
            const label = periodLabel(row.period);
            return <TableRow key={`${row.partner}|${row.period}`} className="align-top">
              <TableCell className="font-medium">{row.partner}</TableCell>
              <TableCell value={row.period}>{label}</TableCell>
              <TableCell className="whitespace-normal">{row.closed
                ? <div className="flex flex-col items-start gap-1">
                  <StatusBadge tone="neutral" icon={Lock}>Kapalı</StatusBadge>
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(row.closed.at, { year: true })} · {row.closed.by ?? "—"}</span>
                </div>
                : <StatusBadge tone="success" icon={LockOpen}>Açık</StatusBadge>}</TableCell>
              <TableCell><div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" nativeButton={false} render={<a href={statementHref(row.partner, row.period)} download/>}
                  aria-label={`Ekstre (CSV): ${row.partner} ${label}`}>
                  <Download data-icon="inline-start" aria-hidden="true"/>Ekstre (CSV)
                </Button>
                {row.closed
                  ? <PartnerPeriodReopenDialog partner={row.partner} period={row.period} label={label}/>
                  : <PartnerPeriodCloseDialog partner={row.partner} period={row.period} label={label} current={row.period === current}/>}
              </div></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>}
        {partners.length > 0 && <form action="/yonetim/partnerler/ekstre" method="get" className="flex flex-wrap items-end gap-4">
          <Field className="w-auto">
            <FieldLabel htmlFor="statement-partner">Partner</FieldLabel>
            <NativeSelect id="statement-partner" name="partner">
              {partners.map(partner => <NativeSelectOption key={partner} value={partner}>{partner}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="statement-period">Dönem</FieldLabel>
            <NativeSelect id="statement-period" name="donem">
              {periods.periods.map(period => <NativeSelectOption key={period} value={period}>{periodLabel(period)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Button type="submit" variant="outline"><Download data-icon="inline-start" aria-hidden="true"/>Ekstre indir</Button>
        </form>}
      </CardContent>
    </Card>

    {periods.events.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Dönem kapanış geçmişi</CardTitle>
        <CardDescription>Son 50 dönem kapanışı ve yeniden açılışı, gerekçesi ya da notuyla.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Zaman · Yapan</TableHead><TableHead>Partner</TableHead><TableHead>Dönem</TableHead><TableHead>İşlem</TableHead><TableHead>Gerekçe / Not</TableHead>
          </TableRow></TableHeader>
          <TableBody>{periods.events.map(event => <TableRow key={event.id} className="align-top">
            <TableCell value={event.createdAt.toISOString()} className="whitespace-normal tabular-nums">{formatDateTime(event.createdAt, { year: true })}
              <span className="block text-muted-foreground">{event.actor ?? "—"}</span></TableCell>
            <TableCell className="font-medium">{event.partner}</TableCell>
            <TableCell value={event.period}>{periodLabel(event.period)}</TableCell>
            <TableCell>{event.action === "close"
              ? <StatusBadge tone="info" icon={Lock}>Kapatıldı</StatusBadge>
              : <StatusBadge tone="warning" icon={LockOpen}>Yeniden açıldı</StatusBadge>}</TableCell>
            <TableCell className="max-w-xs whitespace-normal">{event.reason || "—"}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>}
  </>;
}
