import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { storeErrorBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { checkoutFieldErrors } from "@/modules/store/checkout-field-errors";

/** The checkout page's error look, shared by the page (no-JS redirect) and the form (JS submit). */
export const checkoutAlertClass = cn(storeErrorBox, "mb-4 break-words");

// #788: the order named the lines the supplier refused live; they are listed by their names in the cart.
const lineErrors: Record<string, { title: string; action: string; cart?: boolean }> = {
  stock: { title: "Tedarikçide şu anda bulunmayan ürünler:", action: "Bu ürünleri sepetinden çıkarıp siparişi yeniden onayla.", cart: true },
  price: { title: "Tedarikçide fiyatı değişen ürünler:", action: "Güncel fiyat tedarikçi güncellemesi tamamlanınca sepetine yansıyacak; birkaç dakika sonra sayfayı yenileyip yeniden dene." },
};

/** `field` is the first field the server refused on a validation error (#881); unknown names are ignored. */
export type CheckoutError = { code: string; names: string[]; field?: string };

/** Names of the cart lines among `ids`, once each; ids not in the cart are dropped, so no outside text is shown. */
export function cartLineNames(ids: readonly string[], lineNames: Record<string, string>) {
  return [...new Set(ids)].filter(id => Object.hasOwn(lineNames, id)).map(id => lineNames[id]);
}

/** An order error; with named lines and a line template it lists them, otherwise it shows the code's general text. */
export function CheckoutErrorAlert({ error, errors }: { error: CheckoutError; errors: Record<string, string> }) {
  const lines = error.names.length && Object.hasOwn(lineErrors, error.code) ? lineErrors[error.code] : undefined;
  const field = error.code === "validation" && error.field && Object.hasOwn(checkoutFieldErrors, error.field) ? checkoutFieldErrors[error.field] : undefined;
  if (field) return <Alert className={checkoutAlertClass}>{field}</Alert>;
  if (!lines) return <Alert className={checkoutAlertClass}>{Object.hasOwn(errors, error.code) ? errors[error.code] : errors.stock}</Alert>;
  return <Alert className={checkoutAlertClass}>
    <p className="m-0 font-semibold">{lines.title}</p>
    <ul className="my-1.5 list-disc pl-5">{error.names.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul>
    <p className="m-0">{lines.action}{lines.cart && <> <Link href="/sepet" className="font-semibold underline">Sepete git</Link></>}</p>
  </Alert>;
}
