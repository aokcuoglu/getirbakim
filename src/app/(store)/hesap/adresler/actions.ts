"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentAccount } from "@/modules/auth/session";
import { loginPath } from "@/modules/auth/return-to";
import { createAddress, deleteAddress, setDefaultAddress, updateAddress } from "@/modules/store/account-addresses";
import { addressErrorField, addressInput } from "@/modules/store/address-schema";

const PAGE = "/hesap/adresler";
const idSchema = z.uuid();
const kindSchema = z.enum(["delivery", "invoice"]);

/** The approved account behind the request; anyone else goes to the login page and back here. */
async function addressBookAccount() {
  const account = await currentAccount();
  if (!account?.approved) redirect(loginPath(PAGE));
  return account;
}

function failed(error: string, editId?: string): never {
  const params = new URLSearchParams({ error });
  if (editId) params.set("duzenle", editId);
  redirect(`${PAGE}?${params}#adres-formu`);
}

/** Saves the form's address: a new one, or with the hidden `id` an edit of one of the account's addresses (#950). */
export async function saveAddress(form: FormData) {
  const account = await addressBookAccount();
  const rawId = form.get("id");
  const id = rawId ? idSchema.safeParse(rawId) : null;
  if (id && !id.success) failed("missing");
  const editId = id?.data;
  const parsed = addressInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) failed(addressErrorField(parsed.error.issues) ?? "invalid", editId);
  if (editId) {
    if (!await updateAddress(account.id, editId, parsed.data)) failed("missing");
  } else {
    const created = await createAddress(account.id, parsed.data);
    if ("error" in created) failed(created.error);
  }
  redirect(`${PAGE}?saved=1`);
}

/** Deletes one of the account's addresses. */
export async function removeAddress(form: FormData) {
  const account = await addressBookAccount();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success || !await deleteAddress(account.id, id.data)) failed("missing");
  redirect(`${PAGE}?removed=1`);
}

/** Makes one of the account's addresses its default delivery or invoice address. */
export async function makeDefault(form: FormData) {
  const account = await addressBookAccount();
  const id = idSchema.safeParse(form.get("id")), kind = kindSchema.safeParse(form.get("kind"));
  if (!id.success || !kind.success || !await setDefaultAddress(account.id, id.data, kind.data)) failed("missing");
  redirect(`${PAGE}?saved=1`);
}
