"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { INSTALLMENT_CARDS_NOTE, installmentHint, type InstallmentOption } from "@/modules/payments/installment-plan";
import { money } from "@/modules/store/money";

type InstallmentState = { options: InstallmentOption[]; setCount: (count: number) => void; selected: InstallmentOption };
const InstallmentContext = createContext<InstallmentState | null>(null);

/**
 * Shares the chosen payment option (#886) between the checkout form, the summaries and the payment dialog. Checkout
 * always renders it (with only the single payment when installments are off) so a refresh never remounts the form.
 */
export function InstallmentProvider({ options, children }: { options: InstallmentOption[]; children: ReactNode }) {
  const [count, setCount] = useState(1);
  const selected = options.find(option => option.count === count) ?? options[0];
  return <InstallmentContext.Provider value={{ options, setCount, selected }}>{children}</InstallmentContext.Provider>;
}

/** The chosen option, or null outside checkout. */
export function useInstallment() { return useContext(InstallmentContext); }

/** Payment option radios; the server recomputes the chosen option's total from the submitted count. */
export function InstallmentPicker() {
  const state = useInstallment();
  if (!state) return null;
  const count = state.selected.count;
  return <FieldSet className="gap-3">
    <FieldLegend className="mb-0 text-sm leading-5 font-medium">Ödeme seçenekleri</FieldLegend>
    <RadioGroup name="installments" value={String(count)} onValueChange={value => state.setCount(Number(value))} className="grid gap-2 sm:grid-cols-2">
      {state.options.map(option => <FieldLabel key={option.count} htmlFor={`installment-${option.count}`} className="rounded-[5px]">
        <Field orientation="horizontal" className="min-h-11 items-center">
          <RadioGroupItem value={String(option.count)} id={`installment-${option.count}`}/>
          <FieldContent className="min-w-0">
            <FieldTitle className="text-sm">{option.count === 1 ? "Tek çekim" : `${option.count} taksit`}</FieldTitle>
            <FieldDescription className="text-xs leading-[18px] tabular-nums">{option.count === 1 ? money(option.totalKurus)
              : `Aylık ${money(option.monthlyKurus)} · toplam ${money(option.totalKurus)}`}</FieldDescription>
          </FieldContent>
        </Field>
      </FieldLabel>)}
    </RadioGroup>
    <p className="m-0 text-xs leading-[18px] text-muted-foreground">{INSTALLMENT_CARDS_NOTE}</p>
    {/* The live region exists before the choice changes, so screen readers announce the hint when it is filled. */}
    <p className="m-0 flex items-start gap-1.5 text-[13px] leading-5 text-primary" role="status" aria-live="polite">{count > 1 && <><Info className="mt-0.5 size-4 shrink-0" aria-hidden/>{installmentHint(count)}.</>}</p>
  </FieldSet>;
}

/** "Vade farkı (N taksit)" row of a summary <dl>; nothing for the single payment or outside checkout. */
export function InstallmentFeeRow() {
  const option = useInstallment()?.selected;
  if (!option || option.count === 1) return null;
  return <div className="flex justify-between gap-3"><dt>Vade farkı ({option.count} taksit)</dt><dd className="m-0 text-right tabular-nums">{money(option.feeKurus)}</dd></div>;
}

/** Total of the chosen option; the cash total outside checkout. */
export function InstallmentAmount({ fallbackKurus }: { fallbackKurus: number }) {
  const option = useInstallment()?.selected;
  return <>{money(option?.totalKurus ?? fallbackKurus)}</>;
}
