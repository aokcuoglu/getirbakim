import { Suspense } from "react";
import Link from "next/link";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { cartQuantity, currentCartOwner } from "@/modules/store/cart";
import { AccountMenu } from "@/components/auth/account-menu";
import { GarageButton } from "@/components/garage/garage-button";
import { SiteIcon } from "@/components/site/site-icon";

async function HeaderAccount() {
  const account = await currentAccount();
  return <AccountMenu account={account ? { name: account.name, role: account.role } : null} />;
}

async function HeaderGarage() {
  return <GarageButton vehicle={await currentVehicle()} />;
}

async function HeaderCart() {
  const count = await cartQuantity(await currentCartOwner());
  return <Link href="/sepet" className="cart-tool" aria-label={`Sepetim, ${count} ürün`}>
    <SiteIcon name="cart" size={32} />{count > 0 && <b>{count}</b>}
  </Link>;
}

function LoadingTool({ name, label }: { name: "profile" | "garage"; label: string }) {
  return <button className="header-tool" disabled aria-busy="true" aria-label={`${label} yükleniyor`}>
    <SiteIcon name={name} size={32} /><span><strong>{label}</strong><small>Yükleniyor…</small></span>
  </button>;
}

export function HeaderTools() {
  return <div className="header-tools">
    <Suspense fallback={<LoadingTool name="profile" label="Hesabım" />}><HeaderAccount /></Suspense>
    <Suspense fallback={<LoadingTool name="garage" label="Garajım" />}><HeaderGarage /></Suspense>
    <Suspense fallback={<Link href="/sepet" className="cart-tool" aria-label="Sepetim" aria-busy="true"><SiteIcon name="cart" size={32} /></Link>}><HeaderCart /></Suspense>
  </div>;
}
