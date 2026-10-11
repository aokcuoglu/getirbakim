import { Suspense } from "react";
import Link from "next/link";
import { currentAccount } from "@/modules/auth/session";
import { currentVehicle } from "@/modules/store/garage";
import { cartQuantity, currentCartOwner } from "@/modules/store/cart";
import { AccountMenu } from "@/components/auth/account-menu";
import { GarageButton } from "@/components/garage/garage-button";
import { SiteIcon } from "@/components/site/site-icon";
import { cn } from "@/lib/utils";
import { headerToolClass } from "./header-tool";

const cartClass = "relative flex h-10 w-8 items-center justify-center group-data-[route=home]/route:max-[600px]:size-6 group-data-[route=home]/route:max-[600px]:[&>img]:size-6!";

async function HeaderAccount() {
  const account = await currentAccount();
  return <AccountMenu account={account ? { name: account.name, role: account.role } : null} />;
}

async function HeaderGarage() {
  return <GarageButton vehicle={await currentVehicle()} />;
}

async function HeaderCart() {
  const count = await cartQuantity(await currentCartOwner());
  return <Link href="/sepet" className={cartClass} aria-label={`Sepetim, ${count} ürün`}>
    <SiteIcon name="cart" size={32} />
    {count > 0 && <b className="absolute -top-0.5 -right-1 h-4 min-w-4 rounded-full bg-[#d7452f] px-[3px] text-center text-[10px] leading-4 font-bold text-white">{count}</b>}
  </Link>;
}

function LoadingTool({ name, label }: { name: "profile" | "garage"; label: string }) {
  return <button className={cn(headerToolClass, name === "profile" && "group-data-[route=home]/route:max-[600px]:hidden")} disabled aria-busy="true" aria-label={`${label} yükleniyor`}>
    <SiteIcon name={name} size={32} /><span><strong>{label}</strong><small>Yükleniyor…</small></span>
  </button>;
}

export function HeaderTools() {
  return <div className={cn(
    "flex shrink-0 basis-[422px] items-center justify-between gap-0 max-[1100px]:basis-[310px] max-[1100px]:gap-[15px] max-[850px]:basis-32 max-[600px]:ml-auto max-[600px]:basis-auto",
    "group-data-[route=checkout]/route:hidden",
    "group-data-[route=home]/route:max-[600px]:absolute group-data-[route=home]/route:max-[600px]:top-4 group-data-[route=home]/route:max-[600px]:right-[15px] group-data-[route=home]/route:max-[600px]:m-0 group-data-[route=home]/route:max-[600px]:w-[68px] group-data-[route=home]/route:max-[600px]:justify-start group-data-[route=home]/route:max-[600px]:gap-5",
  )}>
    <Suspense fallback={<LoadingTool name="profile" label="Hesabım" />}><HeaderAccount /></Suspense>
    <Suspense fallback={<LoadingTool name="garage" label="Garajım" />}><HeaderGarage /></Suspense>
    <Suspense fallback={<Link href="/sepet" className={cartClass} aria-label="Sepetim" aria-busy="true"><SiteIcon name="cart" size={32} /></Link>}><HeaderCart /></Suspense>
  </div>;
}
