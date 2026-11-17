import { CircleCheck, CircleMinus, CreditCard } from "lucide-react";
import { saveInstallments } from "@/modules/admin/commerce-actions";
import { INSTALLMENT_COUNTS, installmentTotal, type InstallmentSettings } from "@/modules/payments/installment-plan";
import { money } from "@/modules/store/money";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const percent = (basisPoints: number) => (basisPoints / 100).toFixed(2);
const PREVIEW_KURUS = 100000;

/** Installment settings (#886) on /yonetim/fiyatlandirma; the preview uses the saved rates. */
export function InstallmentSettingsCard({ settings }: { settings: InstallmentSettings }) {
  return <form action={saveInstallments}>
    <Card id="taksit-ayarlari" role="region" aria-labelledby="installments-title">
      <CardHeader>
        <CardTitle><h2 id="installments-title" className="flex items-center gap-2"><CreditCard className="size-4" aria-hidden="true"/>Taksit ve vade farkı</h2></CardTitle>
        <CardDescription>Müşteri toplamı = tek çekim fiyatı × (1 − tek çekim oranı) / (1 − taksit oranı). Tutar TAMI ortak ödeme sayfasında tahsil edilir.</CardDescription>
        <CardAction>{settings.enabled
          ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Taksit açık</Badge>
          : <Badge variant="secondary"><CircleMinus data-icon="inline-start" aria-hidden="true"/>Taksit kapalı</Badge>}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FieldGroup className="grid gap-6 md:grid-cols-2">
          <Field orientation="horizontal" className="md:col-span-2">
            <Switch id="installments-enabled" name="enabled" defaultChecked={settings.enabled}/>
            <FieldLabel htmlFor="installments-enabled">Taksitli satış</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="installments-max">En yüksek taksit</FieldLabel>
            <NativeSelect id="installments-max" name="max" defaultValue={String(settings.max)}>
              {INSTALLMENT_COUNTS.map(count => <NativeSelectOption key={count} value={String(count)}>{count} taksit</NativeSelectOption>)}
            </NativeSelect>
            <FieldDescription>Bu sayının üstündeki taksitler sunulmaz.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="installments-min-basket">Taksit için en düşük sepet (TL)</FieldLabel>
            <Input id="installments-min-basket" name="minBasket" type="number" inputMode="decimal" min={0} max={10000000} step={0.01} defaultValue={(settings.minBasketKurus / 100).toFixed(2)} required/>
            <FieldDescription>Kargo hariç ürün toplamıyla karşılaştırılır. 0 = her sepet.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="installments-single-rate">Tek çekim oranı (%)</FieldLabel>
            <Input id="installments-single-rate" name="singleRate" type="number" inputMode="decimal" min={0} max={50} step={0.01} defaultValue={percent(settings.singleRateBp)} required/>
            <FieldDescription>TAMI tek çekim komisyonu. Taksit oranları bundan düşük olamaz.</FieldDescription>
          </Field>
        </FieldGroup>
        <Table controls={false} aria-label="Taksit oranları">
          <TableHeader><TableRow>
            <TableHead>Taksit</TableHead><TableHead>Oran (%)</TableHead><TableHead className="text-right">1.000 TL için toplam</TableHead><TableHead className="text-right">Aylık</TableHead>
          </TableRow></TableHeader>
          <TableBody>{INSTALLMENT_COUNTS.map(count => {
            const rate = settings.ratesBp[count];
            const total = rate === undefined ? null : installmentTotal(PREVIEW_KURUS, settings.singleRateBp, rate);
            return <TableRow key={count}>
              <TableCell className="tabular-nums">{count} taksit{count > settings.max && <span className="text-muted-foreground"> · sunulmuyor</span>}</TableCell>
              <TableCell><Input name={`rate_${count}`} type="number" inputMode="decimal" min={0} max={50} step={0.01} defaultValue={rate === undefined ? "" : percent(rate)} aria-label={`${count} taksit oranı (%)`} className="max-w-28" required/></TableCell>
              <TableCell className="text-right tabular-nums">{total === null ? "—" : money(total)}</TableCell>
              <TableCell className="text-right tabular-nums">{total === null ? "—" : money(Math.round(total / count))}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-3">
        <p className="text-sm text-muted-foreground">Önizleme kayıtlı oranlarla hesaplanır; kaydettikten sonra güncellenir.</p>
        <SubmitButton pendingLabel="Kaydediliyor…">Taksit ayarlarını kaydet</SubmitButton>
      </CardFooter>
    </Card>
  </form>;
}
