import { RotateCw, TriangleAlert, Webhook } from "lucide-react";
import type { adminPartnerWebhooks } from "@/modules/admin/partners";
import { requeuePartnerWebhookEvent, requeuePartnerWebhookEvents } from "@/modules/admin/partner-actions";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { PARTNER_WEBHOOK_RETENTION_DAYS } from "@/modules/partner/webhook-contract";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** /yonetim/partnerler webhook cards (#1002): per-partner delivery summary and the failing events, with requeue for given-up ones. */
export function PartnerWebhooks({ webhooks }: { webhooks: Awaited<ReturnType<typeof adminPartnerWebhooks>> }) {
  const configured = new Set(webhooks.partners.filter(p => p.endpointState === "configured").map(p => p.code));
  return <>
    <Card>
      <CardHeader>
        <CardTitle>Webhook bildirimleri</CardTitle>
        <CardDescription>Webhook, partnerin sistemine sipariş değiştiğinde otomatik gönderilen doğrulanabilir HTTP bildirimidir. Partner siparişinin durumu, kargo bilgisi, iptali ya da iptal talebi değişince ve iade talebi onaylanınca ya da reddedilince gönderilir; teslim edilemeyen bildirim 72 saat boyunca yeniden denenir, sonra bırakılır.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {webhooks.parseError && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertTitle>Webhook ayarı okunamadı</AlertTitle><AlertDescription>PARTNER_WEBHOOKS_JSON geçerli bir JSON nesnesi değil. Bildirimler gönderilmiyor, 72 saat boyunca bekletiliyor; sistem yöneticisine bildirin.</AlertDescription></Alert>}
        {webhooks.configured ? <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Partner</TableHead><TableHead>Uç nokta</TableHead><TableHead className="text-right">Bekleyen</TableHead>
            <TableHead className="text-right">Bırakılan</TableHead><TableHead className="text-right">Atlanan</TableHead><TableHead>Son teslim</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{webhooks.partners.map(p => <TableRow key={p.code} className="align-top">
            <TableCell className="font-medium">{p.code}</TableCell>
            <TableCell>{p.endpointState === "configured" ? <StatusBadge tone="info">Tanımlı · {p.endpointHost}</StatusBadge>
              : p.endpointState === "disabled" ? <StatusBadge tone="warning">Kapalı · bildirimler bekletiliyor</StatusBadge>
              : p.endpointState === "invalid" ? <StatusBadge tone="warning">Ayar geçersiz · bildirimler bekletiliyor</StatusBadge>
              : p.endpointState === "unreadable" ? <StatusBadge tone="warning">Ayar okunamadı</StatusBadge>
              : <StatusBadge tone="neutral">Tanımsız</StatusBadge>}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(p.pending)}</TableCell>
            <TableCell className="text-right">{p.dead > 0 ? <StatusBadge tone="error">{formatNumber(p.dead)} bırakıldı</StatusBadge> : <span className="tabular-nums">0</span>}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(p.skipped)}</TableCell>
            <TableCell className="tabular-nums">{p.lastDeliveredAt ? formatDateTime(p.lastDeliveredAt, { year: true }) : "—"}</TableCell>
            <TableCell>{p.dead > 0 && p.endpointState === "configured" && <div className="flex justify-end"><form action={requeuePartnerWebhookEvents}>
              <input type="hidden" name="partner" value={p.code}/>
              <SubmitButton variant="outline" size="sm" pendingLabel="Kuyruğa alınıyor…" icon={<RotateCw data-icon="inline-start" aria-hidden="true"/>}>
                Bırakılanları yeniden gönder<span className="sr-only"> ({p.code})</span>
              </SubmitButton>
            </form></div>}</TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Webhook/></EmptyMedia>
            <EmptyTitle>Webhook uç noktası tanımlı değil</EmptyTitle>
            <EmptyDescription>Uç noktalar PARTNER_WEBHOOKS_JSON ortam değişkeniyle tanımlanır. Tanımlamak için sistem yöneticisine bildirin.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">Atlanan: partner için uç nokta tanımlı olmadığından gönderilmeyen bildirimler.</p>
          <p className="text-muted-foreground">Teslim edilen, atlanan ve bırakılan bildirim kayıtları {PARTNER_WEBHOOK_RETENTION_DAYS} gün sonra silinir.</p>
        </div>
      </CardContent>
    </Card>

    {webhooks.problems.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Sorunlu bildirimler</CardTitle>
        <CardDescription>En az bir kez teslim edilemeyen bildirimler. Bırakıldı: partnerin uç noktası 72 saat boyunca başarılı yanıt vermedi. Bu bildirim kendiliğinden yeniden gönderilmez; uç nokta düzeldikten sonra buradan yeniden gönderebilirsiniz. Partner sipariş durumunu API&apos;den sorgulayabilir; uç noktayı partnerle birlikte kontrol edin.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table controls={false}>
          <TableHeader><TableRow>
            <TableHead>Zaman</TableHead><TableHead>Partner</TableHead><TableHead>Sipariş</TableHead><TableHead>Durum</TableHead>
            <TableHead className="text-right">Deneme</TableHead><TableHead>Son yanıt</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{webhooks.problems.map(problem => <TableRow key={problem.id} className="align-top">
            <TableCell value={problem.createdAt.toISOString()} className="whitespace-normal tabular-nums">{formatDateTime(problem.createdAt, { year: true })}
              {problem.requeuedAt && <span className="block text-muted-foreground">Yeniden kuyruğa alındı {formatDateTime(problem.requeuedAt, { year: true })}</span>}</TableCell>
            <TableCell className="font-medium">{problem.partner}</TableCell>
            <TableCell className="tabular-nums">#{problem.orderNumber}</TableCell>
            <TableCell>{problem.status === "dead"
              ? <StatusBadge tone="error">Bırakıldı</StatusBadge>
              : <StatusBadge tone="warning" icon={RotateCw}>Yeniden denenecek</StatusBadge>}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(problem.attempts)}</TableCell>
            <TableCell className="max-w-xs whitespace-normal">{problem.lastError ?? (problem.lastHttpStatus ? `HTTP ${problem.lastHttpStatus}` : "—")}</TableCell>
            <TableCell className="max-w-48 whitespace-normal">{problem.status === "dead" && (configured.has(problem.partner)
              ? <div className="flex justify-end"><form action={requeuePartnerWebhookEvent}>
                <input type="hidden" name="event" value={problem.id}/>
                <SubmitButton variant="outline" size="sm" pendingLabel="Gönderiliyor…" icon={<RotateCw data-icon="inline-start" aria-hidden="true"/>}>
                  Yeniden gönder<span className="sr-only"> (#{problem.orderNumber} · {problem.partner})</span>
                </SubmitButton>
              </form></div>
              : <span className="text-muted-foreground">Uç nokta tanımlı değil; yeniden gönderilemez.</span>)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>}
  </>;
}
