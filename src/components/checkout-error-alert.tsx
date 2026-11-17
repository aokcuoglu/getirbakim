import Link from "next/link";
import { Alert } from "@/components/ui/alert";

/** The checkout page's error look, shared by the page (no-JS redirect) and the form (JS submit). */
export const checkoutAlertClass = "mb-4 rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 break-words text-[#a74130]";

// #788: the order named the lines the supplier refused live; they are listed by their names in the cart.
const lineErrors: Record<string, { title: string; action: string; cart?: boolean }> = {
  stock: { title: "Tedarikçide şu anda bulunmayan ürünler:", action: "Bu ürünleri sepetinden çıkarıp siparişi yeniden onayla.", cart: true },
  price: { title: "Tedarikçide fiyatı değişen ürünler:", action: "Güncel fiyat tedarikçi güncellemesi tamamlanınca sepetine yansıyacak; birkaç dakika sonra sayfayı yenileyip yeniden dene." },
};

export type CheckoutError = { code: string; names: string[] };

/** Names of the cart lines among `ids`, once each; ids not in the cart are dropped, so no outside text is shown. */
export function cartLineNames(ids: readonly string[], lineNames: Record<string, string>) {
  return [...new Set(ids)].filter(id => Object.hasOwn(lineNames, id)).map(id => lineNames[id]);
}

/** An order error; with named lines and a line template it lists them, otherwise it shows the code's general text. */
export function CheckoutErrorAlert({ error, errors }: { error: CheckoutError; errors: Record<string, string> }) {
  const lines = error.names.length && Object.hasOwn(lineErrors, error.code) ? lineErrors[error.code] : undefined;
  if (!lines) return <Alert className={checkoutAlertClass}>{Object.hasOwn(errors, error.code) ? errors[error.code] : errors.stock}</Alert>;
  return <Alert className={checkoutAlertClass}>
    <p className="m-0 font-semibold">{lines.title}</p>
    <ul className="my-1.5 list-disc pl-5">{error.names.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul>
    <p className="m-0">{lines.action}{lines.cart && <> <Link href="/sepet" className="font-semibold underline">Sepete git</Link></>}</p>
  </Alert>;
}
