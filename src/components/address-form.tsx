"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CheckoutAddressFields } from "@/components/checkout-address-fields";
import { checkoutCheckbox, checkoutControl, checkoutLabel, checkoutRequiredMark } from "@/components/checkout-field-classes";
import { useDismissNotice } from "@/components/address-notice";
import { saveAddress } from "@/app/(store)/hesap/adresler/actions";
import type { AccountAddress } from "@/modules/store/account-addresses";
import type { AddressFormValues } from "@/modules/store/address-schema";

const required = <span className={checkoutRequiredMark} aria-hidden>*</span>;

/**
 * The /hesap/adresler form (#950): a new address, or with `address` an edit of it. The province, district, street address
 * and postal code are checkout's fields. A refused save shows its message above the fields and remounts them with what
 * was submitted; a saved one goes back to the page. A ticked box makes the address a default; a default address shows
 * its box ticked and locked, since another address takes the default over. The account's first address (`first`)
 * becomes both defaults without boxes.
 */
export function AddressForm({ address, first }: { address: AccountAddress | null; first: boolean }) {
  const [state, action, pending] = useActionState(saveAddress, null);
  const dismiss = useDismissNotice();
  const typed: AddressFormValues | null = state?.values ?? null;
  const value = (field: keyof AddressFormValues, saved: string | null | undefined) => typed ? typed[field] : saved ?? undefined;
  const defaults = [
    { name: "defaultDelivery", id: "address-default-delivery", text: "Varsayılan teslimat adresim olsun", locked: address?.default_delivery ?? false },
    { name: "defaultInvoice", id: "address-default-invoice", text: "Varsayılan fatura adresim olsun", locked: address?.default_invoice ?? false },
  ] as const;
  return <form action={action} onSubmit={dismiss} className="grid gap-4">
    {state && <Alert role="alert" className="rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]">{state.error}</Alert>}
    {address && <input type="hidden" name="id" value={address.id}/>}
    <div key={`${address?.id ?? "new"}-${state?.attempt ?? 0}`} className="grid gap-4">
      <Field className="gap-1.5"><FieldLabel htmlFor="address-label" className={checkoutLabel}>Adres başlığı {required}</FieldLabel>
        <Input id="address-label" className={checkoutControl} name="label" maxLength={60} placeholder="Örn. Servis, Depo, Merkez" defaultValue={value("label", address?.label)} required/></Field>
      <Field className="gap-1.5"><FieldLabel htmlFor="address-recipient" className={checkoutLabel}>Alıcı ad soyad {required}</FieldLabel>
        <Input id="address-recipient" className={checkoutControl} name="recipientName" autoComplete="name" minLength={2} maxLength={150} defaultValue={value("recipientName", address?.recipient_name)} required/></Field>
      <Field className="gap-1.5"><FieldLabel htmlFor="address-phone" className={checkoutLabel}>Telefon {required}</FieldLabel>
        <Input id="address-phone" className={checkoutControl} type="tel" name="phone" autoComplete="tel" minLength={10} maxLength={20} defaultValue={value("phone", address?.phone)} required/></Field>
      <CheckoutAddressFields initial={typed || address ? { province: value("province", address?.province) ?? null, district: value("district", address?.district) ?? null,
        addressLine: value("addressLine", address?.address_line) ?? null, postalCode: value("postalCode", address?.postal_code) ?? null } : null}/>
      {first ? <FieldDescription>İlk adresin varsayılan teslimat ve fatura adresin olur.</FieldDescription>
        : defaults.map(box => <Field key={box.name} orientation="horizontal" className="items-start gap-2.5">
          <Checkbox id={box.id} name={box.name} defaultChecked={box.locked || typed?.[box.name] === "on"} disabled={box.locked} className={checkoutCheckbox}
            aria-describedby={box.locked ? `${box.id}-hint` : undefined}/>
          <div className="grid gap-1">
            <FieldLabel htmlFor={box.id} className="block text-sm leading-[22px] font-normal">{box.text}{box.locked && <span className="text-muted-foreground"> (şu an varsayılan)</span>}</FieldLabel>
            {box.locked && <FieldDescription id={`${box.id}-hint`}>Başka bir adresi varsayılan yaparak değiştirebilirsin.</FieldDescription>}
          </div>
        </Field>)}
    </div>
    <Button type="submit" disabled={pending} className="h-auto min-h-12 w-full gap-2.5 rounded-lg px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong">{pending ? "Kaydediliyor…" : address ? "Değişiklikleri kaydet" : "Adresi kaydet"} <ChevronRight className="size-4" aria-hidden/></Button>
    {address && <Link href="/hesap/adresler" className="inline-flex min-h-11 items-center justify-center text-sm leading-5 text-primary underline-offset-4 hover:underline">Vazgeç</Link>}
  </form>;
}
