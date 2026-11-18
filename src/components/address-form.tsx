import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CheckoutAddressFields } from "@/components/checkout-address-fields";
import { checkoutControl, checkoutLabel, checkoutRequiredMark } from "@/components/checkout-field-classes";
import type { AccountAddress } from "@/modules/store/account-addresses";

const required = <span className={checkoutRequiredMark} aria-hidden>*</span>;

/**
 * The /hesap/adresler form (#950): a new address, or with `address` an edit of it. The province, district, street address
 * and postal code are checkout's fields, remounted per edited address. A box ticked makes the address a default; a
 * default address shows its box ticked and locked, since another address takes the default over. The account's first
 * address (`first`) becomes both defaults without boxes.
 */
export function AddressForm({ action, address, first }: { action: (form: FormData) => Promise<void>; address: AccountAddress | null; first: boolean }) {
  const defaults = [
    { name: "defaultDelivery", id: "address-default-delivery", text: "Varsayılan teslimat adresim olsun", on: address?.default_delivery ?? false },
    { name: "defaultInvoice", id: "address-default-invoice", text: "Varsayılan fatura adresim olsun", on: address?.default_invoice ?? false },
  ];
  return <form action={action} className="grid gap-4">
    {address && <input type="hidden" name="id" value={address.id}/>}
    <Field className="gap-1.5"><FieldLabel htmlFor="address-label" className={checkoutLabel}>Adres başlığı {required}</FieldLabel>
      <Input id="address-label" className={checkoutControl} name="label" maxLength={60} placeholder="Örn. Servis, Depo, Merkez" defaultValue={address?.label} required/></Field>
    <Field className="gap-1.5"><FieldLabel htmlFor="address-recipient" className={checkoutLabel}>Alıcı ad soyad {required}</FieldLabel>
      <Input id="address-recipient" className={checkoutControl} name="recipientName" autoComplete="name" minLength={2} maxLength={150} defaultValue={address?.recipient_name} required/></Field>
    <Field className="gap-1.5"><FieldLabel htmlFor="address-phone" className={checkoutLabel}>Telefon {required}</FieldLabel>
      <Input id="address-phone" className={checkoutControl} type="tel" name="phone" autoComplete="tel" minLength={10} maxLength={20} defaultValue={address?.phone} required/></Field>
    <CheckoutAddressFields key={address?.id ?? "new"} initial={address && { province: address.province, district: address.district, addressLine: address.address_line, postalCode: address.postal_code }}/>
    {first ? <FieldDescription>İlk adresin varsayılan teslimat ve fatura adresin olur.</FieldDescription>
      : defaults.map(box => <Field key={box.name} orientation="horizontal" className="items-start gap-2.5">
        <Checkbox id={box.id} name={box.name} defaultChecked={box.on} disabled={box.on} className="my-0.5 size-5"/>
        <FieldLabel htmlFor={box.id} className="block text-sm leading-[22px] font-normal">{box.text}{box.on && <span className="text-muted-foreground"> (şu an varsayılan)</span>}</FieldLabel>
      </Field>)}
    <Button type="submit" className="h-auto min-h-12 w-full gap-2.5 rounded-lg px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong">{address ? "Değişiklikleri kaydet" : "Adresi kaydet"} <ChevronRight className="size-4" aria-hidden/></Button>
    {address && <Link href="/hesap/adresler" className="inline-flex min-h-11 items-center justify-center text-sm leading-5 text-primary underline-offset-4 hover:underline">Vazgeç</Link>}
  </form>;
}
