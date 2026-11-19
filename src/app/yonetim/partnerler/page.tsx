import Link from "next/link";
import { ArrowUpRight, CircleAlert, CircleCheck, Handshake } from "lucide-react";
import { adminPartners } from "@/modules/admin/partners";
import { savePartnerLimit } from "@/modules/admin/partner-actions";
import { istanbulToday } from "@/modules/admin/partner-input";
import { formatNumber } from "@/modules/admin/format";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/money";
import { PartnerInvoiceDialog } from "@/components/admin/partner-invoice-dialog";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sourceLabel = { panel: "Panelden", env: "Varsayılan (ortam değişkeni)", none: "Tanımsız" } as const;
/** Kuruş → the TL text the limit input shows ("4500" or "4500.50"). */
const tl = (kurus: number) => kurus % 100 ? (kurus / 100).toFixed(2) : String(kurus / 100);

/** Partner credit (#426): open-order limit, exposure (open + delivered, uninvoiced) and invoicing per partner. */
export default async function Partners({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const partners = await adminPartners();
  const today = istanbulToday();
  const invoiced = Number(params.invoiced);

  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Partnerler ve cari limit</h1>
        <p className="text-muted-foreground">Partner (API) siparişleri cari hesaba yazılır. Alacak; iptal edilmemiş ve teslim edilmemiş siparişler ile teslim edilmiş ama faturalanmamış siparişlerin toplamıdır (kargo dahil). Yeni sipariş alacağı limitin üstüne çıkaracaksa reddedilir; limiti olmayan partner sipariş veremez. Teslim edilen siparişler &quot;Faturalandı&quot; işaretlenince limitten düşer.</p>
      </div>
      <Button variant="outline" nativeButton={false} render={<Link href="/yonetim/siparisler?sahip=partner"/>}>Partner siparişleri<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
    </div>

    {params.saved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{params.saved} için limit kaydedildi; yeni siparişler bu limitle kontrol edilir.</AlertDescription></Alert>}
    {Number.isSafeInteger(invoiced) && invoiced > 0 && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{params.partner ? `${params.partner}: ` : ""}{formatNumber(invoiced)} sipariş faturalandı olarak işaretlendi ve limitten düştü.</AlertDescription></Alert>}
    {params.error === "limit" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Limit kaydedilemedi</AlertTitle><AlertDescription>Limit 0 TL&apos;den büyük, en fazla iki ondalıklı bir tutar olmalı. Boş bırakılırsa varsayılan limit geçerli olur.</AlertDescription></Alert>}

    <Card>
      <CardHeader>
        <CardTitle>Partner alacakları</CardTitle>
        <CardDescription>{formatNumber(partners.length)} partner · tutarlar KDV ve kargo dahil</CardDescription>
      </CardHeader>
      <CardContent>
        {partners.length ? <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Partner</TableHead><TableHead className="text-right">Limit</TableHead><TableHead className="text-right">Açık siparişler</TableHead>
            <TableHead className="text-right">Teslim edildi · faturalanmadı</TableHead><TableHead className="text-right">Toplam alacak</TableHead><TableHead>Kullanım</TableHead>
            <TableHead>Panel limiti</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{partners.map(p => {
            const form = `partner-limit-${p.code}`;
            return <TableRow key={p.code} className="align-top">
              <TableCell><div className="flex flex-col items-start gap-1">
                <span className="font-medium">{p.code}</span>
                {!p.configured && <StatusBadge tone="warning">API anahtarı yok</StatusBadge>}
              </div></TableCell>
              <TableCell className="text-right"><div className="tabular-nums">{p.limitKurus == null ? "—" : money(p.limitKurus)}</div><div className="text-muted-foreground">{sourceLabel[p.source]}</div></TableCell>
              <TableCell className="text-right"><div className="tabular-nums">{money(p.openKurus)}</div><div className="text-muted-foreground tabular-nums">{formatNumber(p.openCount)} sipariş</div></TableCell>
              <TableCell className="text-right"><div className="tabular-nums">{money(p.uninvoicedKurus)}</div><div className="text-muted-foreground tabular-nums">{formatNumber(p.uninvoicedCount)} sipariş</div></TableCell>
              <TableCell className="text-right font-medium tabular-nums">{money(p.exposureKurus)}</TableCell>
              <TableCell>{p.usage.percent == null
                ? <StatusBadge tone="error">Limit yok · sipariş kapalı</StatusBadge>
                : <StatusBadge tone={p.usage.tone}>{p.usage.tone === "error" ? "Limit doldu" : p.usage.tone === "warning" ? "Limite yakın" : "Uygun"} · %{formatNumber(p.usage.percent)}</StatusBadge>}</TableCell>
              <TableCell><InputGroup className="w-40">
                <InputGroupInput className="text-right tabular-nums" form={form} name="limit" inputMode="decimal" aria-label={`${p.code} panel limiti (TL)`}
                  placeholder={p.source === "env" && p.limitKurus != null ? tl(p.limitKurus) : "Boş"} defaultValue={p.panelKurus == null ? "" : tl(p.panelKurus)}/>
                <InputGroupAddon align="inline-end"><InputGroupText>TL</InputGroupText></InputGroupAddon>
              </InputGroup></TableCell>
              <TableCell><div className="flex flex-wrap justify-end gap-2">
                <form id={form} action={savePartnerLimit}><input type="hidden" name="partner" value={p.code}/><SubmitButton variant="outline" aria-label={`${p.code}: Limiti kaydet`}>Kaydet</SubmitButton></form>
                <PartnerInvoiceDialog partner={p.code} days={p.days} today={today}/>
              </div></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Handshake/></EmptyMedia>
            <EmptyTitle>Henüz partner yok</EmptyTitle>
            <EmptyDescription>Partnerler PARTNER_API_KEYS ortam değişkeniyle tanımlanır; tanımlanan partner burada listelenir.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
        <p className="pt-4 text-muted-foreground">Panel limiti boş bırakılırsa varsayılan limit (PARTNER_ORDER_LIMIT_KURUS) geçerli olur; o da yoksa partner sipariş veremez.</p>
      </CardContent>
    </Card>
  </div>;
}
