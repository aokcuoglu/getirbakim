import { redirect } from "next/navigation";

/** The account area starts at the address book (#950). */
export default function Account() {
  redirect("/hesap/adresler");
}
