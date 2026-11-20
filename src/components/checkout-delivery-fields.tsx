"use client";
import { useState } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AccountAddress } from "@/modules/store/account-addresses";
import type { CheckoutPrefill } from "@/modules/store/checkout-prefill";
import { addressInitialOf, CheckoutAddressFields, SavedAddressSelect, type AddressInitial } from "./checkout-address-fields";
import { checkoutCheckbox, checkoutControl, checkoutLabel, checkoutRequiredMark } from "./checkout-field-classes";

const required = <span className={checkoutRequiredMark} aria-hidden>*</span>;

/**
 * Contact and delivery part of the checkout form (#999): name, e-mail, phone, the account's saved-address picker and the
 * delivery address. Choosing a saved address fills the recipient's name, phone and the address fields; "Yeni adres gir"
 * clears the address fields only. Without saved addresses (guests, new accounts) there is no picker and the form starts
 * from the last order's prefill. `manage` shows the link to the address book; `canSave` shows the box that keeps the typed address in the address book.
 */
export function CheckoutDeliveryFields({ prefill, email, addresses, canSave, manage = false }: { prefill: CheckoutPrefill; email?: string; addresses: readonly AccountAddress[]; canSave: boolean; manage?: boolean }) {
  const preselected = addresses.find(address => address.id === prefill.deliveryAddressId) ?? null;
  const [contact, setContact] = useState({ name: prefill.name, phone: prefill.phone, rev: 0 });
  const [delivery, setDelivery] = useState<{ id: string; initial: AddressInitial | null; rev: number }>({ id: preselected?.id ?? "", initial: prefill.delivery, rev: 0 });
  const [announced, setAnnounced] = useState(false);
  const [save, setSave] = useState(false);
  const pick = (id: string) => {
    const chosen = addresses.find(address => address.id === id);
    setDelivery(current => ({ id, initial: chosen ? addressInitialOf(chosen) : null, rev: current.rev + 1 }));
    if (chosen) setContact(current => ({ name: chosen.recipient_name, phone: chosen.phone, rev: current.rev + 1 }));
    setAnnounced(true);
  };
  return <>
    <Field key={`name-${contact.rev}`} className="gap-1.5"><FieldLabel htmlFor="checkout-name" className={checkoutLabel}>Ad soyad {required}</FieldLabel>
      <Input id="checkout-name" className={checkoutControl} name="name" autoComplete="name" minLength={2} maxLength={150} defaultValue={contact.name} required/></Field>
    <Field className="gap-1.5"><FieldLabel htmlFor="checkout-email" className={checkoutLabel}>E-posta {required}</FieldLabel>
      <Input id="checkout-email" className={checkoutControl} type="email" name="email" autoComplete="email" maxLength={200} defaultValue={email} required/></Field>
    <Field key={`phone-${contact.rev}`} className="gap-1.5"><FieldLabel htmlFor="checkout-phone" className={checkoutLabel}>Telefon {required}</FieldLabel>
      <Input id="checkout-phone" className={checkoutControl} type="tel" name="phone" autoComplete="tel" minLength={10} maxLength={20} defaultValue={contact.phone} required/></Field>
    {addresses.length > 0 && <>
      <SavedAddressSelect id="checkout-saved" addresses={addresses} value={delivery.id} onChange={pick}/>
      <p role="status" className="sr-only">{announced ? "Seçilen adres forma dolduruldu." : ""}</p>
    </>}
    {manage && <Link href="/hesap/adresler" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center justify-self-start text-sm leading-5 text-primary underline-offset-4 hover:underline">Adreslerimi yönet<span className="sr-only"> (yeni sekmede açılır)</span></Link>}
    <CheckoutAddressFields key={delivery.rev} initial={delivery.initial}/>
    {canSave && <>
      <Field orientation="horizontal" className="items-start gap-2.5">
        <Checkbox id="checkout-save-address" name="saveAddress" checked={save} onCheckedChange={value => setSave(value === true)} className={checkoutCheckbox}
          aria-controls="checkout-save-address-details" aria-expanded={save}/>
        <FieldLabel htmlFor="checkout-save-address" className="block text-sm leading-[22px] font-normal">Bu adresi adreslerime kaydet</FieldLabel></Field>
      <div id="checkout-save-address-details">{save && <Field className="gap-1.5"><FieldLabel htmlFor="checkout-save-address-label" className={checkoutLabel}>Adres başlığı</FieldLabel>
        <Input id="checkout-save-address-label" className={checkoutControl} name="saveAddressLabel" maxLength={60} placeholder="Örn. Servis, Depo, Merkez" aria-describedby="checkout-save-address-label-hint"/>
        <FieldDescription id="checkout-save-address-label-hint">Boş bırakırsan ilçe ve il adıyla kaydedilir.</FieldDescription></Field>}</div>
    </>}
  </>;
}
