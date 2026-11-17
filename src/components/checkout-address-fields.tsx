"use client";
import { useState } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { districtsOf, findProvince, invoiceTypes, matchName, provinces, type InvoiceType } from "@/modules/store/tr-address";
import { checkoutCombobox, checkoutControl, checkoutLabel, checkoutRequiredMark, checkoutTextarea } from "./checkout-field-classes";

const provinceNames = provinces.map(province => province.name);
const required = <span className={checkoutRequiredMark} aria-hidden>*</span>;

export type AddressInitial = { province: string | null; district: string | null; addressLine: string | null; postalCode: string | null };

/** One searchable list of names; the chosen name is submitted as `name`, and text the browser filled in that equals a name selects it. */
function NameCombobox({ id, name, autoComplete, placeholder, emptyText, options, value, onValueChange, disabled = false }: {
  id: string; name: string; autoComplete: string; placeholder: string; emptyText: string; options: readonly string[];
  value: string | null; onValueChange: (value: string | null) => void; disabled?: boolean;
}) {
  return <Combobox items={options} value={value} onValueChange={onValueChange} name={name} autoComplete={autoComplete} required disabled={disabled} locale="tr"
    onInputValueChange={text => { const match = matchName(options, text); if (match && match !== value) onValueChange(match); }}>
    <ComboboxInput id={id} className={checkoutCombobox} placeholder={placeholder} disabled={disabled}/>
    <ComboboxContent>
      <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      <ComboboxList>{(option: string) => <ComboboxItem key={option} value={option}>{option}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}

/**
 * Delivery address as province, district, street address and optional postal code (#881). The district list follows the
 * province and is empty until one is chosen; an `initial` value outside the lists starts empty.
 */
export function CheckoutAddressFields({ initial }: { initial?: AddressInitial | null }) {
  const startProvince = initial?.province && findProvince(initial.province) ? initial.province : null;
  const [province, setProvince] = useState<string | null>(startProvince);
  const [district, setDistrict] = useState<string | null>(startProvince && initial?.district && districtsOf(startProvince).includes(initial.district) ? initial.district : null);
  const chooseProvince = (next: string | null) => {
    if (next === province) return;
    setProvince(next); setDistrict(null);
  };
  return <>
    <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
      <Field className="gap-1.5"><FieldLabel htmlFor="checkout-province" className={checkoutLabel}>İl {required}</FieldLabel>
        <NameCombobox id="checkout-province" name="province" autoComplete="address-level1" placeholder="İl seç" emptyText="Bu adda il yok." options={provinceNames}
          value={province} onValueChange={chooseProvince}/></Field>
      <Field className="gap-1.5"><FieldLabel htmlFor="checkout-district" className={checkoutLabel}>İlçe {required}</FieldLabel>
        <NameCombobox id="checkout-district" name="district" autoComplete="address-level2" placeholder={province ? "İlçe seç" : "Önce il seç"} emptyText="Bu adda ilçe yok."
          options={province ? districtsOf(province) : []} value={district} onValueChange={setDistrict} disabled={!province}/></Field>
    </div>
    <Field className="gap-1.5"><FieldLabel htmlFor="checkout-address-line" className={checkoutLabel}>Açık adres {required}</FieldLabel>
      <Textarea id="checkout-address-line" className={cn(checkoutTextarea, "min-h-24")} name="addressLine" autoComplete="street-address" minLength={10} maxLength={500} rows={3}
        placeholder="Mahalle, cadde/sokak, bina ve daire no" defaultValue={initial?.addressLine ?? undefined} required/></Field>
    <Field className="gap-1.5"><FieldLabel htmlFor="checkout-postal-code" className={checkoutLabel}>Posta kodu</FieldLabel>
      <Input id="checkout-postal-code" className={checkoutControl} name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="\d{5}" maxLength={5}
        defaultValue={initial?.postalCode ?? undefined}/></Field>
  </>;
}

export type InvoiceInitial = { invoiceType: InvoiceType | null; company: string | null; taxNo: string | null; taxOffice: string | null };

/** Individual or corporate invoice (#881); the corporate fields exist only while it is chosen. */
export function CheckoutInvoiceFields({ initial }: { initial?: InvoiceInitial | null }) {
  const [type, setType] = useState<InvoiceType>(initial?.invoiceType ?? "individual");
  return <FieldSet className="gap-4">
    <FieldLegend variant="label" className={cn(checkoutLabel, "mb-0")}>Fatura türü</FieldLegend>
    <RadioGroup name="invoiceType" value={type} onValueChange={value => setType(value === "corporate" ? "corporate" : "individual")} className="flex flex-wrap gap-6">
      {(Object.keys(invoiceTypes) as InvoiceType[]).map(key => <Field key={key} orientation="horizontal" className="w-auto items-center gap-2.5">
        <RadioGroupItem id={`checkout-invoice-${key}`} value={key} className="size-5"/>
        <FieldLabel htmlFor={`checkout-invoice-${key}`} className="text-sm leading-5 font-normal">{invoiceTypes[key]}</FieldLabel>
      </Field>)}
    </RadioGroup>
    {type === "corporate" && <>
      <Field className="gap-1.5"><FieldLabel htmlFor="checkout-invoice-company" className={checkoutLabel}>Fatura unvanı {required}</FieldLabel>
        <Input id="checkout-invoice-company" className={checkoutControl} name="invoiceCompany" autoComplete="organization" minLength={2} maxLength={200}
          defaultValue={initial?.company ?? undefined} required/></Field>
      <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-invoice-tax-no" className={checkoutLabel}>Vergi kimlik no {required}</FieldLabel>
          <Input id="checkout-invoice-tax-no" className={checkoutControl} name="invoiceTaxNo" autoComplete="off" inputMode="numeric" pattern="\d{10}" minLength={10} maxLength={10}
            defaultValue={initial?.taxNo ?? undefined} required/></Field>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-invoice-tax-office" className={checkoutLabel}>Vergi dairesi {required}</FieldLabel>
          <Input id="checkout-invoice-tax-office" className={checkoutControl} name="invoiceTaxOffice" minLength={2} maxLength={100}
            defaultValue={initial?.taxOffice ?? undefined} required/></Field>
      </div>
    </>}
  </FieldSet>;
}
