import Link from "next/link";
import { setPriceAnomalyStatus } from "@/app/yonetim/tedarikciler/actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminPriceAnomaly } from "@/modules/admin/data";
import { formatNumber } from "@/modules/admin/format";
import { money } from "@/modules/store/money";
import { priceAnomalyThresholds, type PriceAnomalyEvidence } from "@/modules/suppliers/price-anomalies";

const ratio = (evidence: PriceAnomalyEvidence) => `${formatNumber(Math.round(evidence.ratio))}×`;
const currencies = (evidence: PriceAnomalyEvidence) => `${evidence.currency} · marka ${evidence.dominant_currency}`;

/** One sentence of evidence for a currency anomaly (#1030), shared by this card and the Başbuğ product page. */
export function priceAnomalySummary(evidence: PriceAnomalyEvidence) {
  return `${evidence.brand} markasının ${formatNumber(evidence.brand_rows)} satırından ${formatNumber(evidence.currency_rows)} tanesi ${evidence.currency}, `
    + `diğerleri ${evidence.dominant_currency}. Çevrilmiş maliyet ${money(evidence.cost_kurus)}, marka medyanı ${money(evidence.median_kurus)} (${ratio(evidence)}).`;
}

/** The suppliers overview's list of currency anomalies, with the admin's "Anomali değil" decision per row. */
export function SupplierPriceAnomalies({ rows }: { rows: AdminPriceAnomaly[] }) {
  return <Card id="fiyat-anomalileri" role="region" aria-labelledby="price-anomalies">
    <CardHeader><CardTitle><h2 id="price-anomalies">Para birimi anomalileri</h2></CardTitle>
      <CardDescription>Tedarikçinin gönderdiği para birimi markanın geri kalanıyla uyuşmuyor ve çevrilmiş maliyet marka medyanının {formatNumber(priceAnomalyThresholds.RATIO)} katından fazla. Bu satırlar katalogda kalır ama fiyatlanmaz; veriyi tedarikçi düzeltir.</CardDescription></CardHeader>
    <CardContent>
      <Table controls={false}>
        <caption className="sr-only">Para birimi anomalileri</caption>
        <TableHeader><TableRow>
          <TableHead>Ürün</TableHead><TableHead className="hidden md:table-cell">Para birimi</TableHead>
          <TableHead className="hidden text-right md:table-cell">Çevrilmiş maliyet</TableHead><TableHead className="hidden text-right md:table-cell">Marka medyanı</TableHead>
          <TableHead className="text-right">Oran</TableHead><TableHead className="hidden text-right md:table-cell">Diğer teklif</TableHead>
          <TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => {
          const { evidence } = row;
          const open = row.status === "open";
          return <TableRow key={row.supplier_item_id} className="align-top">
            <TableCell className="whitespace-normal md:whitespace-nowrap">
              <Link href={`/yonetim/tedarikciler/basbug/urun/${row.supplier_item_id}`} className="font-mono font-medium underline-offset-4 hover:underline">{row.code}</Link>
              <div className="text-muted-foreground">{evidence.brand}</div>
              <div className="text-muted-foreground tabular-nums md:hidden">{currencies(evidence)} · {money(evidence.cost_kurus)}</div>
            </TableCell>
            <TableCell className="hidden md:table-cell">{currencies(evidence)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{money(evidence.cost_kurus)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{money(evidence.median_kurus)}</TableCell>
            <TableCell className="text-right tabular-nums">{ratio(evidence)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{evidence.other_offer_kurus === null ? "—" : money(evidence.other_offer_kurus)}</TableCell>
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
