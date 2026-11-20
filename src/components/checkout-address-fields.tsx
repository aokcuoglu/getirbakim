"use client";
import { useEffect, useRef, useState } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { districtsOf, findProvince, invoiceTypes, matchName, postalCodeFits, provinces, type InvoiceType } from "@/modules/store/tr-address";
import type { AccountAddress } from "@/modules/store/account-addresses";
import { checkoutCheckbox, checkoutCombobox, checkoutControl, checkoutLabel, checkoutRequiredMark, checkoutSelect, checkoutTextarea } from "./checkout-field-classes";

const provinceNames = provinces.map(province => province.name);
const required = <span className={checkoutRequiredMark} aria-hidden>*</span>;
const postalMismatch = "Posta kodu seçili ille uyuşmuyor";

/** The browser stops the submit when a 5-digit postal code does not start with the chosen province's plate code. */
function postalError(code: string, province: string | null) {
  const selected = province ? findProvince(province) : null;
  return selected && /^\d{5}$/.test(code.trim()) && !postalCodeFits(code.trim(), selected) ? postalMismatch : "";
}

export type AddressInitial = { province: string | null; district: string | null; addressLine: string | null; postalCode: string | null };

export const addressInitialOf = (address: AccountAddress): AddressInitial =>
  ({ province: address.province, district: address.district, addressLine: address.address_line, postalCode: address.postal_code });

/**
 * The account's saved addresses as a select (#999); the last option, value "", is a new address. It has no `name`, so it
 * is never submitted: the page only uses it to fill the fields.
 */
export function SavedAddressSelect({ id, addresses, value, onChange }: { id: string; addresses: readonly AccountAddress[]; value: string; onChange: (id: string) => void }) {
  return <Field className="gap-1.5"><FieldLabel htmlFor={id} className={checkoutLabel}>Kayıtlı adreslerim</FieldLabel>
    <NativeSelect id={id} className={checkoutSelect} value={value} onChange={event => onChange(event.currentTarget.value)}>
      {addresses.map(address => <NativeSelectOption key={address.id} value={address.id}>{`${address.label} · ${address.district}/${address.province}`}</NativeSelectOption>)}
      <NativeSelectOption value="">Yeni adres gir</NativeSelectOption>
    </NativeSelect></Field>;
}

/** Typing (and deleting) keeps filtering the list; only text written at once, as the browser's autofill does, may select. */
function typed(event: Event | undefined) {
  return typeof InputEvent !== "undefined" && event instanceof InputEvent && /^(insertText|insertCompositionText|insertFromPaste|delete)/.test(event.inputType);
}

/**
 * One searchable list of names; the chosen name is submitted as `name`. Text the browser filled in, or text left in the box
 * on blur, that equals a name selects it.
 */
function NameCombobox({ id, name, autoComplete, placeholder, emptyText, options, value, onValueChange, disabled = false, describedBy }: {
  id: string; name: string; autoComplete: string; placeholder: string; emptyText: string; options: readonly string[];
  value: string | null; onValueChange: (value: string | null) => void; disabled?: boolean; describedBy?: string;
}) {
  const select = (text: string) => { const match = matchName(options, text); if (match && match !== value) onValueChange(match); };
  return <Combobox items={options} value={value} onValueChange={onValueChange} name={name} autoComplete={autoComplete} required disabled={disabled} locale="tr"
    onInputValueChange={(text, details) => { if (details.reason === "input-change" && !typed(details.event)) select(text); }}>
    <ComboboxInput id={id} className={checkoutCombobox} placeholder={placeholder} disabled={disabled} autoComplete={autoComplete} aria-describedby={describedBy}
      onBlur={event => select(event.currentTarget.value)}/>
    <ComboboxContent>
      <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      <ComboboxList>{(option: string) => <ComboboxItem key={option} value={option} className="min-h-11 text-base md:min-h-8 md:text-sm">{option}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}

/** Element ids, submitted names and autofill tokens of the delivery address (#881) and the separate invoice address (#916). */
const scopes = {
  delivery: {
    id: "checkout", province: "province", district: "district", addressLine: "addressLine", postalCode: "postalCode",
    autoComplete: { province: "address-level1", district: "address-level2", addressLine: "street-address", postalCode: "postal-code" },
  },
  invoice: {
    id: "checkout-invoice", province: "invoiceProvince", district: "invoiceDistrict", addressLine: "invoiceAddressLine", postalCode: "invoicePostalCode",
    autoComplete: { province: "billing address-level1", district: "billing address-level2", addressLine: "billing street-address", postalCode: "billing postal-code" },
  },
} as const;

/**
 * An address as province, district, street address and optional postal code (#881): the delivery address, or with
 * `scope="invoice"` the separate invoice address (#916). The district list follows the province and is empty until one
 * is chosen; choosing the same province again keeps the district. An `initial` value outside the lists starts empty.
 */
export function CheckoutAddressFields({ initial, scope = "delivery" }: { initial?: AddressInitial | null; scope?: keyof typeof scopes }) {
  const { id, autoComplete, ...names } = scopes[scope];
  const startProvince = initial?.province && findProvince(initial.province) ? initial.province : null;
  const [province, setProvince] = useState<string | null>(startProvince);
  const [district, setDistrict] = useState<string | null>(startProvince && initial?.district && districtsOf(startProvince).includes(initial.district) ? initial.district : null);
  const postal = useRef<HTMLInputElement>(null);
  const chooseProvince = (next: string | null) => {
    if (next === province) return;
    setProvince(next); setDistrict(null);
  };
  // Checked again when the province changes; the server checks it too.
  useEffect(() => { if (postal.current) postal.current.setCustomValidity(postalError(postal.current.value, province)); }, [province]);
  return <>
    <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
      <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-province`} className={checkoutLabel}>İl {required}</FieldLabel>
        <NameCombobox id={`${id}-province`} name={names.province} autoComplete={autoComplete.province} placeholder="İl seç" emptyText="Bu adda il yok." options={provinceNames}
          value={province} onValueChange={chooseProvince}/></Field>
      <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-district`} className={checkoutLabel}>İlçe {required}</FieldLabel>
        {!province && <FieldDescription id={`${id}-district-hint`}>Önce il seç.</FieldDescription>}
        <NameCombobox id={`${id}-district`} name={names.district} autoComplete={autoComplete.district} placeholder={province ? "İlçe seç" : "Önce il seç"} emptyText="Bu adda ilçe yok."
          options={province ? districtsOf(province) : []} value={district} onValueChange={setDistrict} disabled={!province} describedBy={province ? undefined : `${id}-district-hint`}/></Field>
    </div>
    <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-address-line`} className={checkoutLabel}>Açık adres {required}</FieldLabel>
      <Textarea id={`${id}-address-line`} className={cn(checkoutTextarea, "min-h-24")} name={names.addressLine} autoComplete={autoComplete.addressLine} minLength={10} maxLength={500} rows={3}
        placeholder="Mahalle, cadde/sokak, bina ve daire no" defaultValue={initial?.addressLine ?? undefined} required/></Field>
    <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-postal-code`} className={checkoutLabel}>Posta kodu</FieldLabel>
      <Input ref={postal} id={`${id}-postal-code`} className={checkoutControl} name={names.postalCode} autoComplete={autoComplete.postalCode} inputMode="numeric" pattern="\d{5}" maxLength={5}
        title="5 haneli posta kodu" aria-describedby={`${id}-postal-code-hint`} defaultValue={initial?.postalCode ?? undefined}
        onChange={event => event.currentTarget.setCustomValidity(postalError(event.currentTarget.value, province))}/>
      <FieldDescription id={`${id}-postal-code-hint`}>5 haneli</FieldDescription></Field>
  </>;
}

export type InvoiceInitial = { invoiceType: InvoiceType | null; company: string | null; taxNo: string | null; taxOffice: string | null; address?: AddressInitial | null };

/**
 * Individual or corporate invoice (#881); the corporate fields exist only while it is chosen. The invoice goes to the
 * delivery address unless the box is cleared, which shows a separate invoice address (#916); `initial.address` with a
 * province starts with it shown. While the box is ticked the address block stays mounted but hidden and disabled, so
 * ticking it again keeps what was typed, and its fields are neither submitted nor checked by the browser.
 */
export function CheckoutInvoiceFields({ initial, addresses = [], selectedId = null }: { initial?: InvoiceInitial | null; addresses?: readonly AccountAddress[]; selectedId?: string | null }) {
  const [type, setType] = useState<InvoiceType>(initial?.invoiceType ?? "individual");
  const [same, setSame] = useState(!initial?.address?.province);
  // Choosing a saved address (or "Yeni adres gir") remounts the invoice address fields with it (#999).
  const [picked, setPicked] = useState<{ id: string; initial: AddressInitial | null | undefined; rev: number }>({ id: selectedId ?? "", initial: initial?.address, rev: 0 });
  const pick = (id: string) => {
    const chosen = addresses.find(address => address.id === id);
    setPicked(current => ({ id, initial: chosen ? addressInitialOf(chosen) : null, rev: current.rev + 1 }));
  };
  return <><FieldSet className="gap-4">
    <FieldLegend variant="label" className={cn(checkoutLabel, "mb-0")}>Fatura türü</FieldLegend>
    <RadioGroup name="invoiceType" value={type} onValueChange={value => setType(value === "corporate" ? "corporate" : "individual")} className="flex flex-wrap gap-x-6 gap-y-0">
      {(Object.keys(invoiceTypes) as InvoiceType[]).map(key => <Field key={key} orientation="horizontal" className="min-h-11 w-auto items-center gap-2.5">
        <RadioGroupItem id={`checkout-invoice-${key}`} value={key} className="size-5"/>
        <FieldLabel htmlFor={`checkout-invoice-${key}`} className="min-h-11 text-sm leading-5 font-normal">{invoiceTypes[key]}</FieldLabel>
      </Field>)}
    </RadioGroup>
    {type === "corporate" && <>
      <Field className="gap-1.5"><FieldLabel htmlFor="checkout-invoice-company" className={checkoutLabel}>Fatura unvanı {required}</FieldLabel>
        <Input id="checkout-invoice-company" className={checkoutControl} name="invoiceCompany" autoComplete="organization" minLength={2} maxLength={200}
          defaultValue={initial?.company ?? undefined} required/></Field>
      <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1">
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-invoice-tax-no" className={checkoutLabel}>Vergi kimlik no / TC kimlik no {required}</FieldLabel>
          <Input id="checkout-invoice-tax-no" className={checkoutControl} name="invoiceTaxNo" autoComplete="off" inputMode="numeric" pattern="\d{10,11}" minLength={10} maxLength={11}
            title="Şirketler için 10 haneli VKN, şahıs işletmeleri için 11 haneli TC kimlik no" aria-describedby="checkout-invoice-tax-no-hint" defaultValue={initial?.taxNo ?? undefined} required/>
          <FieldDescription id="checkout-invoice-tax-no-hint">Şirketler için 10 haneli VKN, şahıs işletmeleri için 11 haneli TC kimlik no</FieldDescription></Field>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-invoice-tax-office" className={checkoutLabel}>Vergi dairesi {required}</FieldLabel>
          <Input id="checkout-invoice-tax-office" className={checkoutControl} name="invoiceTaxOffice" minLength={2} maxLength={100}
            defaultValue={initial?.taxOffice ?? undefined} required/></Field>
      </div>
    </>}
  </FieldSet>
  <FieldSet className="gap-4">
    <FieldLegend variant="label" className={cn(checkoutLabel, "mb-0")}>Fatura adresi</FieldLegend>
    <input type="hidden" name="invoiceAddressMode" value={same ? "same" : "separate"}/>
    <Field orientation="horizontal" className="items-start gap-2.5">
      <Checkbox id="checkout-invoice-same" checked={same} onCheckedChange={value => setSame(value === true)} className={checkoutCheckbox}
        aria-controls="checkout-invoice-address" aria-expanded={!same}/>
      <FieldLabel htmlFor="checkout-invoice-same" className="block text-sm leading-[22px] font-normal">Fatura adresi teslimat adresiyle aynı</FieldLabel></Field>
    <FieldSet id="checkout-invoice-address" className="gap-4" hidden={same} disabled={same}>
      {addresses.length > 0 && <SavedAddressSelect id="checkout-invoice-saved" addresses={addresses} value={picked.id} onChange={pick}/>}
      <CheckoutAddressFields key={picked.rev} scope="invoice" initial={picked.initial}/>
    </FieldSet>
  </FieldSet></>;
}
