"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Search, CarFront } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/components/layout/store-route";
import { cn } from "@/lib/utils";
import { AuthModal, type AuthMode } from "./auth-modal";
import { AccountTriggerLabel, accountTriggerClass, type HeaderAccount } from "./account-trigger";
import { logout } from "@/modules/auth/actions";
import { storeButton } from "@/components/store-button";

const benefits = [
  { icon: ShieldCheck, title: "Güvenli hesap erişimi", text: "Siparişlerini ve adreslerini hesabından yönet." },
  { icon: CarFront, title: "Aracın her zaman elinin altında", text: "Araç bilgilerini garajına ekleyerek kolayca ulaş." },
  { icon: Search, title: "Kolay parça arama", text: "Ürün, marka veya OEM koduyla doğru parçayı ara." },
];

/**
 * The account popover and the sign-in dialog, loaded on the first hover, focus or click on the header's "Hesabım" (#1017).
 * It replaces the light button of account-menu.tsx: `defaultOpen` when that button was clicked while this loaded,
 * `restoreFocus` when it had keyboard focus, so the swap keeps the user where they were.
 */
export function AccountPanel({ account, defaultOpen, initialPhoneOffset, restoreFocus }: { account: HeaderAccount; defaultOpen: boolean; initialPhoneOffset: number; restoreFocus: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [phoneOffset, setPhoneOffset] = useState(initialPhoneOffset);
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);
  const phone = useMediaQuery("(max-width: 599.98px)");
  const tablet = useMediaQuery("(min-width: 600px) and (max-width: 1100px)");

  // The shell button this replaced had focus: its successor takes it before paint (an open popover then moves it inside).
  useLayoutEffect(() => { if (restoreFocus) trigger.current?.focus({ preventScroll: true }); }, [restoreFocus]);

  function openModal(mode: AuthMode) {
    setOpen(false);
    modal.current?.open(mode);
  }

  return <>
    <div className="relative max-w-[206px] min-w-0">
      <Popover open={open} onOpenChange={next => {
        // On phones the panel spans the screen with a 15px gutter, whatever the trigger's position.
        if (next && trigger.current) setPhoneOffset(15 - trigger.current.getBoundingClientRect().left);
        setOpen(next);
      }}>
        <PopoverTrigger ref={trigger} aria-label="Hesabım" className={accountTriggerClass}>
          <AccountTriggerLabel account={account} />
        </PopoverTrigger>
        {open && <div aria-hidden="true" className="pointer-events-auto fixed inset-0 z-49 bg-[rgba(33,43,54,.5)]" />}
        <PopoverContent
          side="bottom" sideOffset={phone ? 31 : 6}
          align={tablet ? "end" : "start"} alignOffset={phone ? phoneOffset : tablet ? 0 : -64}
          className={cn(
            "block w-[285px] max-w-[calc(100vw-30px)] gap-0 rounded-[3px] border border-border bg-white p-5 text-left text-sm leading-5 text-foreground shadow-[0_6px_24px_rgba(33,43,54,.1)] ring-0",
            // The little arrow towards the trigger (none on phones, where the panel spans the screen).
            "before:absolute before:-top-[7px] before:left-[71px] before:size-3 before:rotate-45 before:border-t before:border-l before:border-border before:bg-white",
            tablet && "before:right-2.5 before:left-auto",
            phone && "w-[calc(100vw-30px)] max-w-none before:hidden max-h-[calc(100dvh-105px)] overflow-y-auto",
          )}>
          {account ? <>
            <h3 className="mt-0 mb-2.5 text-lg leading-[26px] font-semibold">{account.name}</h3>
            <p className="mt-0 mb-5 text-sm leading-5 text-muted-foreground">{account.role === "service" ? "Onaylı profesyonel hesabınla devam et." : "Hesabınla alışverişe devam et."}</p>
            <Button nativeButton={false} className={cn(storeButton({ intent: "primary", size: "md" }), "mt-3 flex w-full first:mt-0")} render={<Link href={account.role === "admin" ? "/yonetim" : "/garaj"} onClick={() => setOpen(false)} />}>{account.role === "admin" ? "Yönetim paneli" : "Garajım"}</Button>
            <Button nativeButton={false} variant="outline" className={cn(storeButton({ intent: "outline", size: "md" }), "mt-3 flex w-full first:mt-0")} render={<Link href="/siparisler" onClick={() => setOpen(false)} />}>Siparişlerim</Button>
            <Button nativeButton={false} variant="outline" className={cn(storeButton({ intent: "outline", size: "md" }), "mt-3 flex w-full first:mt-0")} render={<Link href="/hesap/adresler" onClick={() => setOpen(false)} />}>Adreslerim</Button>
            <form action={logout} className="mt-3"><Button type="submit" variant="outline" className={cn(storeButton({ intent: "outline", size: "md" }), "flex w-full")}>Çıkış yap</Button></form>
          </> : <>
            <Button type="button" className={cn(storeButton({ intent: "primary", size: "md" }), "mt-3 flex w-full first:mt-0")} onClick={() => openModal("login")}>Giriş yap</Button>
            <Button type="button" variant="outline" className={cn(storeButton({ intent: "outline", size: "md" }), "mt-3 flex w-full first:mt-0")} onClick={() => openModal("register")}>Kayıt ol</Button>
            <ul className="mt-6 mb-0 list-none p-0">
              {benefits.map(({ icon: Icon, title, text }) => <li key={title} className="flex gap-2.5 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
                <Icon size={20} strokeWidth={1.5} className="shrink-0" />
                <div><b className="block text-xs leading-[18px] font-medium">{title}</b><p className="mt-0.5 mb-0 text-[11px] leading-4 text-muted-foreground">{text}</p></div>
              </li>)}
            </ul>
          </>}
        </PopoverContent>
      </Popover>
    </div>
    <AuthModal ref={modal} onClosed={() => trigger.current?.focus()} />
  </>;
}
