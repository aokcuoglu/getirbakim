"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Search, CarFront } from "lucide-react";
import { SiteIcon } from "@/components/site/site-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { headerToolClass } from "@/components/navigation/header-tool";
import { useMediaQuery } from "@/components/layout/store-route";
import { cn } from "@/lib/utils";
import { AuthModal, type AuthMode } from "./auth-modal";
import { logout } from "@/modules/auth/actions";

const menuButton = "mt-3 flex h-auto min-h-11 w-full rounded-[3px] px-4 py-2.5 text-xs leading-5 font-medium first:mt-0";
const primaryButton = cn(menuButton, "border-brand bg-brand text-white hover:border-brand-strong hover:bg-brand-strong active:bg-[#005a9f]");
const outlineButton = cn(menuButton, "border-input bg-white text-foreground hover:border-[#54626e] hover:bg-[#f9fafb] hover:text-foreground");
const benefits = [
  { icon: ShieldCheck, title: "Güvenli hesap erişimi", text: "Servis hesabınla sana özel fiyatları görüntüle." },
  { icon: CarFront, title: "Aracın her zaman elinin altında", text: "Araç bilgilerini garajına ekleyerek kolayca ulaş." },
  { icon: Search, title: "Kolay parça arama", text: "Ürün, marka veya OEM koduyla doğru parçayı ara." },
];

export function AccountMenu({ account }: { account: { name: string; role: string } | null }) {
  const [open, setOpen] = useState(false);
  const [phoneOffset, setPhoneOffset] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);
  const phone = useMediaQuery("(max-width: 600px)");
  const tablet = useMediaQuery("(min-width: 601px) and (max-width: 1100px)");

  function openModal(mode: AuthMode) {
    setOpen(false);
    modal.current?.open(mode);
  }

  return <>
    <div className="relative max-w-[206px] min-w-0 group-data-[route=home]/route:max-[600px]:hidden">
      <Popover open={open} onOpenChange={next => {
        // On phones the panel spans the screen with a 15px gutter, whatever the trigger's position.
        if (next && trigger.current) setPhoneOffset(15 - trigger.current.getBoundingClientRect().left);
        setOpen(next);
      }}>
        <PopoverTrigger ref={trigger} aria-label="Hesabım" className={cn(headerToolClass, "w-full min-w-0")}>
          <SiteIcon name="profile" size={32} />
          <span className="max-w-[164px] min-w-0">
            <strong className="max-w-none! whitespace-nowrap"><span className="min-w-0 truncate" title={account?.name}>{account ? account.name : "Hesabım"}</span><SiteIcon name="chevron" size={13} /></strong>
            <small>{account ? "B2B hesabı" : "Giriş yap"}</small>
          </span>
        </PopoverTrigger>
        {open && <div aria-hidden="true" className="fixed inset-0 z-49 bg-[rgba(33,43,54,.5)]" />}
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
            <p className="mt-0 mb-5 text-sm leading-5 text-muted-foreground">Onaylı profesyonel hesabınla devam et.</p>
            <Button nativeButton={false} className={primaryButton} render={<Link href={account.role === "admin" ? "/yonetim" : "/garaj"} onClick={() => setOpen(false)} />}>{account.role === "admin" ? "Yönetim paneli" : "Garajım"}</Button>
            <form action={logout} className="mt-3"><Button type="submit" variant="outline" className={cn(outlineButton, "mt-0")}>Çıkış yap</Button></form>
          </> : <>
            <Button type="button" className={primaryButton} onClick={() => openModal("login")}>Log In</Button>
            <Button type="button" variant="outline" className={outlineButton} onClick={() => openModal("register")}>Register</Button>
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
