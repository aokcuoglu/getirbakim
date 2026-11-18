"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentAccount } from "@/modules/auth/session";
import { loginPath } from "@/modules/auth/return-to";
import { createAddress, deleteAddress, setDefaultAddress, updateAddress } from "@/modules/store/account-addresses";
import { addressErrorField, addressFieldErrors, addressFormFields, addressInput, type AddressFormState, type AddressFormValues } from "@/modules/store/address-schema";

const PAGE = "/hesap/adresler";
const idSchema = z.uuid();
const kindSchema = z.enum(["delivery", "invoice"]);
const missing = "Adres bulunamadı. Sayfayı yenileyip yeniden dene.";

/** The approved account behind the request; anyone else goes to the login page and back here. */
async function addressBookAccount() {
  const account = await currentAccount();
  if (!account?.approved) redirect(loginPath(PAGE));
  return account;
}

/**
 * Saves the form's address: a new one, or with the hidden `id` an edit of one of the account's addresses (#950). A
 * refusal returns its message with the submitted values (useActionState), so the form keeps what was typed; a saved
 * address goes back to the page.
 */
export async function saveAddress(previous: AddressFormState, form: FormData): Promise<AddressFormState> {
  const account = await addressBookAccount();
  const values = Object.fromEntries(addressFormFields.map(field => {
    const value = form.get(field);
    return [field, typeof value === "string" ? value.slice(0, 1000) : ""];
  })) as AddressFormValues;
  const refuse = (error: string): AddressFormState => ({ error, values, attempt: (previous?.attempt ?? 0) + 1 });
  const rawId = form.get("id");
  const id = rawId ? idSchema.safeParse(rawId) : null;
  if (id && !id.success) return refuse(missing);
  const parsed = addressInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const field = addressErrorField(parsed.error.issues);
    return refuse(field ? addressFieldErrors[field] : "Adres bilgilerini kontrol et.");
  }
  if (id?.data) {
    if (!await updateAddress(account.id, id.data, parsed.data)) return refuse(missing);
  } else {
    const created = await createAddress(account.id, parsed.data);
    if ("error" in created) return refuse(addressFieldErrors.limit);
  }
  redirect(`${PAGE}?saved=1`);
}

/** Deletes one of the account's addresses. */
export async function removeAddress(form: FormData) {
  const account = await addressBookAccount();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success || !await deleteAddress(account.id, id.data)) redirect(`${PAGE}?error=missing`);
  redirect(`${PAGE}?removed=1`);
}

/** Makes one of the account's addresses its default delivery or invoice address. */
export async function makeDefault(form: FormData) {
  const account = await addressBookAccount();
  const id = idSchema.safeParse(form.get("id")), kind = kindSchema.safeParse(form.get("kind"));
  if (!id.success || !kind.success || !await setDefaultAddress(account.id, id.data, kind.data)) redirect(`${PAGE}?error=missing`);
  redirect(`${PAGE}?default=1`);
}
