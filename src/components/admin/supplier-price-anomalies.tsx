import Link from "next/link";
import { setPriceAnomalyStatus } from "@/app/yonetim/tedarikciler/actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminPriceAnomaly } from "@/modules/admin/data";
import { formatNumber } from "@/modules/admin/format";
import { money } from "@/modules/store/money";
import { priceAnomalyThresholds, type PriceAnomalyEvidence, type PriceAnomalyKind } from "@/modules/suppliers/price-anomalies";

const kindLabels: Record<PriceAnomalyKind, string> = { currency: "Para birimi", "offer-outlier": "Teklif sapması" };
const low = (evidence: PriceAnomalyEvidence) => evidence.direction === "low";
/** How many times off the compared value the row is (evidence.ratio is below 1 when the row is too low). */
const times = (evidence: PriceAnomalyEvidence) => formatNumber(Math.round(low(evidence) ? 1 / evidence.ratio : evidence.ratio));
const ratio = (evidence: PriceAnomalyEvidence) => `${times(evidence)}×${low(evidence) ? " düşük" : ""}`;
const currencies = (kind: PriceAnomalyKind, evidence: PriceAnomalyEvidence) => kind === "offer-outlier"
  ? `${evidence.currency} · olası ${evidence.relabel_currency ?? evidence.dominant_currency}` : `${evidence.currency} · marka ${evidence.dominant_currency}`;
/** Other suppliers' TRY offers for the same product: one price, or the lowest–highest range. */
const offers = (evidence: PriceAnomalyEvidence) => {
  if (evidence.other_offer_kurus === null) return "—";
  const min = evidence.other_offer_min_kurus ?? evidence.other_offer_kurus;
  return min === evidence.other_offer_kurus ? money(min) : `${money(min)}–${money(evidence.other_offer_kurus)}`;
};
/** The value the row is compared with: the brand median (currency) or the nearest other offer (offer-outlier). */
const compared = (kind: PriceAnomalyKind, evidence: PriceAnomalyEvidence) => kind === "currency" ? money(evidence.median_kurus)
  : money((low(evidence) ? evidence.other_offer_min_kurus : null) ?? evidence.other_offer_kurus ?? 0);

/** One sentence of evidence for a price anomaly (#1030, #1050), shared by this card and the Başbuğ product page. */
export function priceAnomalySummary(kind: PriceAnomalyKind, evidence: PriceAnomalyEvidence) {
  if (kind === "offer-outlier") {
    const plural = (evidence.other_offers ?? 1) > 1;
    return `Aynı ürünün diğer tedarikçi ${plural ? "teklifleri" : "teklifi"} ${offers(evidence)}; bu satır ${money(evidence.cost_kurus)} `
      + `(${times(evidence)} kat ${low(evidence) ? "düşük" : "yüksek"}). Değer ${evidence.relabel_currency ?? evidence.dominant_currency} okununca tekliflerle uyuşuyor.`;
  }
  const brand = `${evidence.brand} markasının ${formatNumber(evidence.brand_rows)} satırından ${formatNumber(evidence.currency_rows)} tanesi ${evidence.currency}, `
    + `diğerleri ${evidence.dominant_currency}.`;
  return low(evidence)
    ? `${brand} Çevrilmiş maliyet ${money(evidence.cost_kurus)}, marka medyanı ${money(evidence.median_kurus)}: ${times(evidence)} kat düşük; değer ${evidence.dominant_currency} okununca normal.`
    : `${brand} Çevrilmiş maliyet ${money(evidence.cost_kurus)}, marka medyanı ${money(evidence.median_kurus)} (${ratio(evidence)}).`;
}

/** The suppliers overview's list of price anomalies (currency and cross-offer), with the admin's "Anomali değil" decision per row. */
export function SupplierPriceAnomalies({ rows }: { rows: AdminPriceAnomaly[] }) {
  return <Card id="fiyat-anomalileri" role="region" aria-labelledby="price-anomalies">
    <CardHeader><CardTitle><h2 id="price-anomalies">Fiyat anomalileri</h2></CardTitle>
      <CardDescription>Para birimi: satırın para birimi markanın geri kalanıyla uyuşmuyor ve çevrilmiş maliyet marka medyanından en az {formatNumber(priceAnomalyThresholds.RATIO)} kat yüksek ya da düşük. Teklif sapması: maliyet aynı ürünün diğer tedarikçi tekliflerinden en az {formatNumber(priceAnomalyThresholds.RATIO)} kat uzak ve değer başka bir para biriminde okununca tekliflerle uyuşuyor. Bu satırlar katalogda kalır ama fiyatlanmaz; veriyi tedarikçi düzeltir.</CardDescription></CardHeader>
    <CardContent>
      <Table controls={false}>
        <caption className="sr-only">Fiyat anomalileri</caption>
        <TableHeader><TableRow>
          <TableHead>Ürün</TableHead><TableHead className="hidden md:table-cell">Tür</TableHead><TableHead className="hidden md:table-cell">Para birimi</TableHead>
          <TableHead className="hidden text-right md:table-cell">Çevrilmiş maliyet</TableHead><TableHead className="hidden text-right md:table-cell">Karşılaştırma</TableHead>
          <TableHead className="text-right">Oran</TableHead><TableHead className="hidden text-right md:table-cell">Diğer teklif</TableHead>
          <TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => {
          const { kind, evidence } = row;
          const open = row.status === "open";
          return <TableRow key={row.supplier_item_id} className="align-top">
            <TableCell className="whitespace-normal md:whitespace-nowrap">
              <Link href={`/yonetim/tedarikciler/basbug/urun/${row.supplier_item_id}`} className="font-mono font-medium underline-offset-4 hover:underline">{row.code}</Link>
              <div className="text-muted-foreground">{evidence.brand}</div>
              <div className="text-muted-foreground tabular-nums md:hidden">{kindLabels[kind]} · {currencies(kind, evidence)} · {money(evidence.cost_kurus)}</div>
            </TableCell>
            <TableCell className="hidden md:table-cell"><StatusBadge tone="neutral">{kindLabels[kind]}</StatusBadge></TableCell>
            <TableCell className="hidden md:table-cell">{currencies(kind, evidence)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{money(evidence.cost_kurus)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{compared(kind, evidence)}<div className="text-muted-foreground">{kind === "currency" ? "marka medyanı" : "diğer teklif"}</div></TableCell>
            <TableCell className="text-right tabular-nums">{ratio(evidence)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{offers(evidence)}</TableCell>
            <TableCell>{open ? <StatusBadge tone="warning">Fiyatlanmıyor</StatusBadge> : <StatusBadge tone="neutral">Anomali değil</StatusBadge>}</TableCell>
            <TableCell>
              <form action={setPriceAnomalyStatus}>
                <input type="hidden" name="id" value={row.supplier_item_id}/>
                <input type="hidden" name="status" value={open ? "dismissed" : "open"}/>
                <SubmitButton variant="outline" size="sm" aria-label={`${row.code}: ${open ? "Anomali değil" : "Yeniden işaretle"}`}>{open ? "Anomali değil" : "Yeniden işaretle"}</SubmitButton>
              </form>
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </CardContent>
  </Card>;
}
