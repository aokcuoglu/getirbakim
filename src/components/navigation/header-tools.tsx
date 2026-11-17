import { Suspense } from "react";
import Link from "next/link";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { shownVehicle } from "@/modules/store/vehicle-label";
import { cartQuantity, currentCartOwner } from "@/modules/store/cart";
import { AccountMenu } from "@/components/auth/account-menu";
import { GarageButton } from "@/components/garage/garage-button";
import { SiteIcon } from "@/components/site/site-icon";
import { headerToolClass } from "./header-tool";
import { CartBadge } from "./cart-badge";

const cartClass = "header-cart";

async function HeaderAccount() {
  const account = await currentAccount();
  return <AccountMenu account={account ? { name: account.name, role: account.role } : null} />;
}

async function HeaderGarage() {
  return <GarageButton vehicle={shownVehicle(await currentVehicle())} />;
}

/** The count with its render time; a plain helper so the timestamp is not read during component render. */
async function cartSeed() {
  const count = await cartQuantity(await currentCartOwner());
  return { count, renderedAt: Date.now() };
}

async function HeaderCart() {
  const { count, renderedAt } = await cartSeed();
  return <CartBadge className={cartClass} count={count} renderedAt={renderedAt} />;
}

function LoadingTool({ name, label }: { name: "profile" | "garage"; label: string }) {
  return <button className={headerToolClass} disabled aria-busy="true" aria-label={`${label} yükleniyor`}>
    <SiteIcon name={name} size={32} /><span><strong>{label}</strong><small>Yükleniyor…</small></span>
  </button>;
}

export function HeaderTools() {
  return <div className="header-tools">
    <Suspense fallback={<LoadingTool name="profile" label="Hesabım" />}><HeaderAccount /></Suspense>
    <Suspense fallback={<LoadingTool name="garage" label="Garajım" />}><HeaderGarage /></Suspense>
    <Suspense fallback={<Link href="/sepet" className={cartClass} aria-label="Sepetim" aria-busy="true"><SiteIcon name="cart" size={32} /></Link>}><HeaderCart /></Suspense>
  </div>;
}
