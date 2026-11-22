import Link from "next/link";
import { ArrowUpRight, Banknote, CircleAlert, CircleCheck, CirclePause, CirclePlay, FileText, Handshake, Info, Lock, TriangleAlert } from "lucide-react";
import { adminPartnerInvoices, adminPartnerPeriods, adminPartners, adminPartnerWebhooks } from "@/modules/admin/partners";
import { savePartnerDiscountRate, savePartnerLimit, savePartnerPaymentTerm, setPartnerIntake } from "@/modules/admin/partner-actions";
import { istanbulToday, paymentMethodLabel, percentText, periodLabel } from "@/modules/admin/partner-input";
import { formatDateTime, formatDay, formatNumber } from "@/modules/admin/format";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/money";
import { PartnerIntakeDialog } from "@/components/admin/partner-intake-dialog";
import { PartnerInvoiceChangeDialog } from "@/components/admin/partner-invoice-change-dialog";
import { PartnerInvoiceDialog } from "@/components/admin/partner-invoice-dialog";
import { PartnerPaymentDialog } from "@/components/admin/partner-payment-dialog";
import { PartnerPaymentVoidDialog } from "@/components/admin/partner-payment-void-dialog";
import { PartnerPeriods } from "@/components/admin/partner-periods";
import { PartnerWebhooks } from "@/components/admin/partner-webhooks";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const sourceLabel = { panel: "Panelden", env: "Varsayılan (ortam değişkeni)", none: "Tanımsız" } as const;
const discountSourceLabel = { panel: "Panelden", env: "Varsayılan (ortam değişkeni)", none: "İndirim yok" } as const;
/** A panel discount for the change line; null = the fallback. */
const discountText = (bps: number | null) => bps == null ? "varsayılan" : `%${percentText(bps)}`;
/** Kuruş → the TL text the limit input shows ("4500" or "4500.50"). */
const tl = (kurus: number) => kurus % 100 ? (kurus / 100).toFixed(2) : String(kurus / 100);
/** A positive whole count from the query string, else null. */
const countParam = (value: string | undefined) => { const count = Number(value); return Number.isSafeInteger(count) && count > 0 ? count : null; };

/** Partner credit (#426): open-order limit, exposure (open + delivered, uninvoiced) and invoicing per partner. */
export default async function Partners({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const [partners, { invoices, changes, payments, orphanCount, collections }, webhooks, periods] = await Promise.all([adminPartners(), adminPartnerInvoices(),
    adminPartnerWebhooks(), adminPartnerPeriods()]);
  const today = istanbulToday();
  const invoiced = Number(params.invoiced);
  const corrected = countParam(params.corrected), undone = countParam(params.undone);
  // Query values are echoed only when they name a listed partner.
  const known = (value: string | undefined) => value && partners.some(p => p.code === value) ? value : null;
  const saved = known(params.saved), partner = known(params.partner), paused = known(params.paused), resumed = known(params.resumed);
  const discountSaved = known(params.discount), termSaved = known(params.term), collected = known(params.collected), voided = known(params.voided);
  const requeuedCount = countParam(params.count);
  // A period (#1200) is echoed only as a valid `YYYY-MM`.
  const donem = params.donem && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.donem) ? params.donem : null;
  const periodClosed = donem ? known(params.period_closed) : null, periodReopened = donem ? known(params.period_reopened) : null;

  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Partnerler, cari limit ve B2B indirim</h1>
        <p className="text-muted-foreground">Partner (API) siparişleri cari hesaba yazılır. Alacak; iptal edilmemiş ve teslim edilmemiş siparişler ile teslim edilmiş ama faturalanmamış siparişlerin toplamıdır (kargo dahil). Yeni sipariş alacağı limitin üstüne çıkaracaksa reddedilir; limiti olmayan partner sipariş veremez. Teslim edilen siparişler &quot;Faturalandı&quot; işaretlenince limitten düşer; yanlış işaret gerekçeyle düzeltilebilir ya da geri alınabilir.</p>
        <p className="text-muted-foreground">B2B indirim, partnerin KDV hariç liste fiyatından düşülür ve ürün fiyatlarına, tekliflere ve siparişlere hemen uygulanır; fiyat hiçbir zaman maliyetin altına inmez. Değişiklikten önce alınmış teklifle verilen sipariş &quot;fiyat değişti&quot; diye reddedilir, partner yeni teklif alır.</p>
        <p className="text-muted-foreground">Bir partnerin sipariş alımı geçici olarak durdurulabilir; durdurulan partner yeni teklif alamaz ve sipariş veremez.</p>
      </div>
      <Button variant="outline" nativeButton={false} render={<Link href="/yonetim/siparisler?sahip=partner"/>}>Partner siparişleri<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
    </div>

    {saved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{saved} için limit kaydedildi; yeni siparişler bu limitle kontrol edilir.</AlertDescription></Alert>}
    {Number.isSafeInteger(invoiced) && invoiced > 0 && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}{formatNumber(invoiced)} sipariş faturalandı olarak işaretlendi ve limitten düştü.</AlertDescription></Alert>}
    {corrected && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}{formatNumber(corrected)} siparişin fatura bilgisi düzeltildi; alacak değişmedi.</AlertDescription></Alert>}
    {undone && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}{formatNumber(undone)} siparişin faturalandı işareti geri alındı; bu siparişler yeniden alacağa ve limite sayılıyor.</AlertDescription></Alert>}
    {paused && <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>{paused} için sipariş alımı durduruldu; yeni teklif ve sipariş istekleri reddedilir.</AlertDescription></Alert>}
    {resumed && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{resumed} için sipariş alımı yeniden açıldı.</AlertDescription></Alert>}
    {discountSaved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{discountSaved} için B2B indirim kaydedildi; ürün fiyatları en geç 30 saniye içinde, yeni teklifler hemen bu oranla hesaplanır.</AlertDescription></Alert>}
    {params.webhook === "delivered" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}bildirim yeniden gönderildi ve teslim edildi.</AlertDescription></Alert>}
    {params.webhook === "pending" && <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}bildirim yeniden kuyruğa alındı ama henüz teslim edilemedi; sistem 72 saat boyunca denemeyi sürdürür.</AlertDescription></Alert>}
    {params.webhook === "queued" && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}{requeuedCount ? `${formatNumber(requeuedCount)} bildirim` : "Bırakılan bildirimler"} yeniden kuyruğa alındı; birkaç dakika içinde gönderilir.</AlertDescription></Alert>}
    {params.webhook === "gone" && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>Bildirim artık bırakılmış değil; liste güncellendi.</AlertDescription></Alert>}
    {params.webhook === "no_endpoint" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{partner ? `${partner}: ` : ""}Partnerin webhook uç noktası tanımlı ya da geçerli değil; bildirim yeniden gönderilemedi.</AlertDescription></Alert>}
    {params.error === "discount" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>{partner ? `${partner}: indirim kaydedilemedi` : "İndirim kaydedilemedi"}</AlertTitle><AlertDescription>İndirim %0 ile %90 arasında, en fazla iki ondalıklı bir oran olmalı. Boş bırakılırsa varsayılan indirim geçerli olur.</AlertDescription></Alert>}
    {termSaved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{termSaved} için vade kaydedildi; faturaların vade tarihleri buna göre hesaplanır.</AlertDescription></Alert>}
    {collected && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{collected} için tahsilat kaydedildi.</AlertDescription></Alert>}
    {periodClosed && donem && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{periodClosed} için {periodLabel(donem)} dönemi kapatıldı; bu aya tarihli faturalar ve bu ay ödenen tahsilatlar artık değiştirilemez.</AlertDescription></Alert>}
    {periodReopened && donem && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{periodReopened} için {periodLabel(donem)} dönemi yeniden açıldı.</AlertDescription></Alert>}
    {voided && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{voided} için tahsilat iptal edildi; faturanın kalan tutarı yeniden açıldı.</AlertDescription></Alert>}
    {params.error === "term" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>{partner ? `${partner}: vade kaydedilemedi` : "Vade kaydedilemedi"}</AlertTitle><AlertDescription>Vade 0 ile 365 arasında tam gün olmalı. Boş bırakılırsa vade tanımsız olur ve faturalar vadesi geçmiş sayılmaz.</AlertDescription></Alert>}
    {orphanCount > 0 && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertTitle>Faturası bulunamayan tahsilat var</AlertTitle><AlertDescription>{formatNumber(orphanCount)} tahsilatın fatura numarası ve tarihi hiçbir işaretli siparişle eşleşmiyor; bu tahsilatlar hiçbir faturaya sayılmıyor. Tahsilatlar listesinden kontrol edip gerekiyorsa iptal edin.</AlertDescription></Alert>}
    {params.error === "intake" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>Sipariş alımı ayarı kaydedilemedi. Sayfayı yenileyip yeniden deneyin.</AlertDescription></Alert>}
    {params.error === "limit" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>{partner ? `${partner}: limit kaydedilemedi` : "Limit kaydedilemedi"}</AlertTitle><AlertDescription>Limit 0 TL&apos;den büyük, en fazla iki ondalıklı bir tutar olmalı. Boş bırakılırsa varsayılan limit geçerli olur.</AlertDescription></Alert>}

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
            <TableHead>Panel limiti</TableHead><TableHead>B2B indirim</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{partners.map(p => {
            const form = `partner-limit-${p.code}`;
            return <TableRow key={p.code} className="align-top">
              <TableCell className="whitespace-normal"><div className="flex flex-col items-start gap-1">
                <span className="font-medium">{p.code}</span>
                {!p.configured && <StatusBadge tone="warning">API anahtarı yok</StatusBadge>}
                {p.intakePausedAt && <>
                  <StatusBadge tone="warning" icon={CirclePause}>Durduruldu</StatusBadge>
                  <span className="text-muted-foreground tabular-nums">Sipariş alımı durduruldu · {formatDateTime(p.intakePausedAt, { year: true })} · {p.intakePausedBy ?? "—"}</span>
                </>}
              </div></TableCell>
              <TableCell className="text-right"><div className="tabular-nums">{p.limitKurus == null ? "—" : money(p.limitKurus)}</div><div className="text-muted-foreground">{sourceLabel[p.source]}</div></TableCell>
              <TableCell className="text-right"><div className="tabular-nums">{money(p.openKurus)}</div><div className="text-muted-foreground tabular-nums">{formatNumber(p.openCount)} sipariş</div></TableCell>
              <TableCell className="text-right"><div className="tabular-nums">{money(p.uninvoicedKurus)}</div><div className="text-muted-foreground tabular-nums">{formatNumber(p.uninvoicedCount)} sipariş</div></TableCell>
              <TableCell className="text-right font-medium tabular-nums">{money(p.exposureKurus)}</TableCell>
              <TableCell>{p.usage.percent == null
                ? <StatusBadge tone="warning">Limit yok · sipariş kapalı</StatusBadge>
                : <StatusBadge tone={p.usage.tone}>{p.usage.tone === "error" ? "Limit doldu" : p.usage.tone === "warning" ? "Limite yakın" : "Uygun"} · %{formatNumber(p.usage.percent)}</StatusBadge>}</TableCell>
              <TableCell><InputGroup className="w-40">
                <InputGroupInput className="text-right tabular-nums" form={form} name="limit" inputMode="decimal" aria-label={`${p.code} panel limiti (TL)`}
                  placeholder={p.source === "env" && p.limitKurus != null ? tl(p.limitKurus) : "Boş"} defaultValue={p.panelKurus == null ? "" : tl(p.panelKurus)}/>
                <InputGroupAddon align="inline-end"><InputGroupText>TL</InputGroupText></InputGroupAddon>
              </InputGroup></TableCell>
              <TableCell className="max-w-48 whitespace-normal"><div className="flex flex-col gap-1">
                <form action={savePartnerDiscountRate} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="partner" value={p.code}/>
                  <InputGroup className="w-28">
                    <InputGroupInput className="text-right tabular-nums" name="discount" inputMode="decimal" aria-label={`${p.code} B2B indirim (yüzde)`}
                      placeholder={p.discount.source === "env" ? percentText(p.discount.discountBps) : "Boş"} defaultValue={p.panelDiscountBps == null ? "" : percentText(p.panelDiscountBps)}/>
                    <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
                  </InputGroup>
                  <SubmitButton variant="outline" aria-label={`${p.code}: İndirimi kaydet`}>İndirimi kaydet</SubmitButton>
                </form>
                <span className="tabular-nums">Geçerli: %{percentText(p.discount.discountBps)}</span>
                <span className="text-muted-foreground">{discountSourceLabel[p.discount.source]}</span>
                {p.discountChange && <span className="text-muted-foreground tabular-nums">Son değişiklik: {discountText(p.discountChange.oldBps)} → {discountText(p.discountChange.newBps)} · {formatDateTime(p.discountChange.changedAt, { year: true })} · {p.discountChange.changedBy ?? "—"}</span>}
              </div></TableCell>
              <TableCell className="whitespace-normal"><div className="flex flex-col items-end gap-2">
                <form id={form} action={savePartnerLimit}><input type="hidden" name="partner" value={p.code}/><SubmitButton variant="outline" aria-label={`${p.code}: Limiti kaydet`}>Limiti kaydet</SubmitButton></form>
                <PartnerInvoiceDialog partner={p.code} days={p.days} today={today}/>
                {p.intakePausedAt
                  ? <form action={setPartnerIntake}><input type="hidden" name="partner" value={p.code}/><input type="hidden" name="paused" value="0"/>
                    <SubmitButton variant="outline" aria-label={`${p.code}: Sipariş alımını aç`} icon={<CirclePlay data-icon="inline-start" aria-hidden="true"/>}>Sipariş alımını aç</SubmitButton></form>
                  : <PartnerIntakeDialog partner={p.code}/>}
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
        <p className="text-muted-foreground">B2B indirim boş bırakılırsa varsayılan indirim (PARTNER_B2B_DISCOUNT_BPS) geçerli olur; o da yoksa indirim uygulanmaz. %0 girilirse varsayılan yok sayılır, indirim uygulanmaz.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Tahsilat ve vade</CardTitle>
        <CardDescription>Vade, faturanın tarihine eklenen gün sayısıdır; kalan tutarı olan fatura vade tarihinden sonraki gün vadesi geçmiş sayılır. Vade boş bırakılırsa tanımsızdır ve faturalar vadesi geçmiş sayılmaz. Tutarlar cari limiti etkilemez.</CardDescription>
      </CardHeader>
      <CardContent>
        {collections.length ? <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Partner</TableHead><TableHead>Vade (gün)</TableHead><TableHead className="text-right">Tahsil edilmemiş</TableHead><TableHead className="text-right">Vadesi geçmiş</TableHead>
          </TableRow></TableHeader>
          <TableBody>{collections.map(c => <TableRow key={c.code}>
            <TableCell className="font-medium">{c.code}</TableCell>
            <TableCell><form action={savePartnerPaymentTerm} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="partner" value={c.code}/>
              <InputGroup className="w-28">
                <InputGroupInput className="text-right tabular-nums" name="term" inputMode="numeric" aria-label={`Vade (gün) · ${c.code}`} placeholder="Tanımsız" defaultValue={c.termDays ?? ""}/>
                <InputGroupAddon align="inline-end"><InputGroupText>gün</InputGroupText></InputGroupAddon>
              </InputGroup>
              <SubmitButton variant="outline" aria-label={`Vadeyi kaydet · ${c.code}`}>Vadeyi kaydet</SubmitButton>
            </form></TableCell>
            <TableCell className="text-right tabular-nums">{money(c.uncollectedKurus)}</TableCell>
            <TableCell className="text-right">{c.overdueCount > 0
              ? <><div className="flex items-center justify-end gap-1 font-medium text-destructive tabular-nums"><CircleAlert className="size-4" aria-hidden="true"/>{money(c.overdueKurus)}</div>
                <div className="text-muted-foreground tabular-nums">{formatNumber(c.overdueCount)} fatura vadesi geçti</div></>
              : <span className="text-muted-foreground tabular-nums">{money(0)}</span>}</TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Handshake/></EmptyMedia>
            <EmptyTitle>Henüz partner yok</EmptyTitle>
            <EmptyDescription>Partner tanımlanınca vadesi ve tahsil edilmemiş tutarı burada görünür.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
      </CardContent>
    </Card>

    <PartnerPeriods periods={periods}/>

    <PartnerWebhooks webhooks={webhooks}/>

    <Card>
      <CardHeader>
        <CardTitle>Kesilen faturalar</CardTitle>
        <CardDescription>Faturalandı işaretlenen siparişler fatura numarası ve tarihine göre: kalan tutarı olan tüm faturalar ve tamamı ödenmiş son 100 fatura. Partnerin ödemeleri &quot;Tahsilat gir&quot; ile girilir; kısmi ödeme girilebilir, kalan tutardan fazlası girilemez. Vade tarihi = fatura tarihi + partnerin vadesi. Tahsilat ve vade yalnız takip içindir, cari limiti değiştirmez. Yanlış işaret gerekçeyle düzeltilir ya da geri alınır; tahsilatı olan faturanın işareti, tahsilatlar iptal edilmeden geri alınamaz. Tek bir siparişin işareti Siparişler sayfasından geri alınır. Kapalı aya tarihli fatura değiştirilemez.</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length ? <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Partner</TableHead><TableHead>Fatura no</TableHead><TableHead>Durum</TableHead><TableHead>Fatura tarihi</TableHead><TableHead>Vade tarihi</TableHead>
            <TableHead className="text-right">Tutar</TableHead><TableHead className="text-right">Kalan</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{invoices.map(invoice => <TableRow key={`${invoice.partner}|${invoice.invoiceRef}|${invoice.invoiceDate}`} className="align-top">
            <TableCell className="font-medium">{invoice.partner}</TableCell>
            <TableCell>{invoice.invoiceRef}</TableCell>
            <TableCell>{invoice.state === "paid" ? <StatusBadge tone="success">Ödendi</StatusBadge>
              : invoice.state === "overdue" ? <div className="flex flex-col items-start gap-1">
                <StatusBadge tone="error">Vadesi geçti · {formatNumber(invoice.overdueDays)} gün</StatusBadge>
                {invoice.collectedKurus > 0 && <StatusBadge tone="warning">Kısmi ödendi</StatusBadge>}
              </div>
              : invoice.state === "partial" ? <StatusBadge tone="warning">Kısmi ödendi</StatusBadge>
              : <StatusBadge tone="neutral">{invoice.dueDate ? "Açık" : "Açık · vade tanımsız"}</StatusBadge>}</TableCell>
            <TableCell value={formatDay(invoice.invoiceDate)} className="whitespace-normal"><div className="flex flex-col items-start gap-1">
              <span className="tabular-nums">{formatDay(invoice.invoiceDate)}</span>
              {invoice.periodClosed && <StatusBadge tone="neutral" icon={Lock}>Dönem kapalı</StatusBadge>}
            </div></TableCell>
            <TableCell className="tabular-nums">{invoice.dueDate ? formatDay(invoice.dueDate) : <span className="text-muted-foreground">Tanımsız</span>}</TableCell>
            <TableCell className="text-right"><div className="tabular-nums">{money(invoice.totalKurus)}</div>
              <div className="text-muted-foreground tabular-nums">{formatNumber(invoice.count)} sipariş</div></TableCell>
            <TableCell className="text-right"><div className={invoice.balanceKurus ? "font-medium tabular-nums" : "text-muted-foreground tabular-nums"}>{money(invoice.balanceKurus)}</div>
              {invoice.collectedKurus > 0 && <div className="text-muted-foreground tabular-nums">Tahsil edilen {money(invoice.collectedKurus)}</div>}</TableCell>
            <TableCell><div className="flex flex-wrap justify-end gap-2">
              {invoice.state !== "paid" && <PartnerPaymentDialog invoice={invoice} today={today}/>}
              {!invoice.periodClosed && <PartnerInvoiceChangeDialog invoice={invoice} today={today}/>}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText/></EmptyMedia>
            <EmptyTitle>Henüz faturalandı işareti yok</EmptyTitle>
            <EmptyDescription>Teslim edilen siparişler &quot;Faturalandı işaretle&quot; ile işaretlenince faturaları burada listelenir.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Tahsilatlar</CardTitle>
        <CardDescription>Geçerli tüm tahsilatlar ve iptal edilen son 50 tahsilat. Yanlış girilen tahsilat düzeltilmez ya da silinmez; gerekçeyle iptal edilir ve doğrusu yeniden girilir. Tahsilatı olan faturanın işareti, tahsilatlar iptal edilmeden geri alınamaz.</CardDescription>
      </CardHeader>
      <CardContent>
        {payments.length ? <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Kayıt zamanı</TableHead><TableHead>Partner</TableHead><TableHead>Fatura</TableHead><TableHead>Ödeme tarihi</TableHead><TableHead>Yöntem</TableHead>
            <TableHead className="text-right">Tutar</TableHead><TableHead>Not</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{payments.map(payment => <TableRow key={payment.id} className="align-top">
            <TableCell className="whitespace-normal tabular-nums">{formatDateTime(payment.recordedAt, { year: true })}<span className="block text-muted-foreground">{payment.recordedBy ?? "—"}</span></TableCell>
            <TableCell className="font-medium">{payment.partner}</TableCell>
            <TableCell className="whitespace-normal tabular-nums">{payment.invoiceRef}<span className="block text-muted-foreground">{formatDay(payment.invoiceDate)}</span></TableCell>
            <TableCell value={formatDay(payment.paidOn)} className="whitespace-normal"><div className="flex flex-col items-start gap-1">
              <span className="tabular-nums">{formatDay(payment.paidOn)}</span>
              {payment.paidPeriodClosed && <StatusBadge tone="neutral" icon={Lock}>Dönem kapalı</StatusBadge>}
            </div></TableCell>
            <TableCell>{paymentMethodLabel(payment.method)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(payment.amountKurus)}</TableCell>
            <TableCell className="max-w-xs whitespace-normal">{payment.note || "—"}</TableCell>
            <TableCell className="max-w-xs whitespace-normal">{payment.voidedAt
              ? <div className="flex flex-col items-start gap-1">
                <StatusBadge tone="error">İptal edildi</StatusBadge>
                <span className="text-muted-foreground tabular-nums">{formatDateTime(payment.voidedAt, { year: true })} · {payment.voidedBy ?? "—"}</span>
                <span>{payment.voidReason}</span>
              </div>
              : <StatusBadge tone="neutral" icon={CircleCheck}>Geçerli</StatusBadge>}</TableCell>
            <TableCell><div className="flex justify-end">{!payment.voidedAt && !payment.paidPeriodClosed && <PartnerPaymentVoidDialog paymentId={payment.id} partner={payment.partner}
              invoiceRef={payment.invoiceRef} amountKurus={payment.amountKurus} paidOn={payment.paidOn}/>}</div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Banknote/></EmptyMedia>
            <EmptyTitle>Henüz tahsilat yok</EmptyTitle>
            <EmptyDescription>Kesilen faturalardan &quot;Tahsilat gir&quot; ile girilen ödemeler burada listelenir.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
      </CardContent>
    </Card>

    {changes.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Fatura düzeltme geçmişi</CardTitle>
        <CardDescription>Faturalandı işaretinde yapılan son 50 düzeltme ve geri alma, gerekçesiyle.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Zaman · Yapan</TableHead><TableHead>Partner</TableHead><TableHead>İşlem</TableHead><TableHead>Eski → Yeni</TableHead>
            <TableHead className="text-right">Sipariş</TableHead><TableHead>Gerekçe</TableHead>
          </TableRow></TableHeader>
          <TableBody>{changes.map(change => <TableRow key={change.changeId} className="align-top">
            <TableCell value={change.changedAt.toISOString()} className="whitespace-normal tabular-nums">{formatDateTime(change.changedAt, { year: true })}<span className="block text-muted-foreground">{change.changedBy ?? "—"}</span></TableCell>
            <TableCell className="font-medium">{change.partner}</TableCell>
            <TableCell>{change.action === "undo" ? <StatusBadge tone="warning">Geri alındı</StatusBadge> : <StatusBadge tone="info">Düzeltildi</StatusBadge>}</TableCell>
            <TableCell className="max-w-xs whitespace-normal tabular-nums">{change.oldRef} · {formatDay(change.oldDate)} → {change.newRef && change.newDate ? `${change.newRef} · ${formatDay(change.newDate)}` : "işaret kaldırıldı"}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(change.count)}</TableCell>
            <TableCell className="max-w-xs whitespace-normal">{change.reason}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>}
  </div>;
}
