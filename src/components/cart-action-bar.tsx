import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Phone-only bar that keeps the cart total and the checkout action in reach while the lines scroll (#877). */
export const cartBarClass = "sticky bottom-0 z-30 -mx-3 mt-4 flex items-center gap-3 border-t border-border bg-white pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))] pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_#212b360d] min-[761px]:hidden";

const action = "h-auto min-h-12 w-full gap-2.5 rounded-[5px] px-4 py-3 text-sm font-semibold";

export function CartActionBar({ total, valid }: { total: string; valid: boolean }) {
  return <div className={cartBarClass} role="region" aria-label="Sepet toplamı">
    <div className="min-w-0 text-sm leading-5 wrap-anywhere">Toplam <small className="block text-xs text-muted-foreground">KDV dahil</small><strong className="text-base font-semibold tabular-nums">{total}</strong></div>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
    {!valid && <p id="cart-bar-invalid" className="m-0 text-xs leading-4 font-medium text-destructive">Uygun olmayan ürünler var</p>}
    {valid
      ? <Button nativeButton={false} className={`${action} hover:bg-brand-strong`} render={<Link href="/siparis-olustur"/>}><LockKeyhole className="size-[18px]" aria-hidden/>Siparişi tamamla</Button>
      : <Button disabled className={action} aria-describedby="cart-bar-invalid"><LockKeyhole className="size-[18px]" aria-hidden/>Siparişi tamamla</Button>}
    </div>
  </div>;
}
