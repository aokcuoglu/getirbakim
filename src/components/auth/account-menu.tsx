"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Search, CarFront } from "lucide-react";
import { SiteIcon } from "@/components/site/site-icon";
import { AuthModal, type AuthMode } from "./auth-modal";
import { logout } from "@/modules/auth/actions";

export function AccountMenu({ account }: { account: { name: string; role: string } | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", close);
    if (open) document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function openModal(mode: AuthMode) {
    setOpen(false);
    modal.current?.open(mode);
  }

  return <>
    <div className="account-tool" ref={root}>
      <button className="header-tool" ref={trigger} type="button" aria-label="Hesabım" aria-expanded={open} aria-controls="account-popover" onClick={() => setOpen(!open)}>
        <SiteIcon name="profile" size={32} />
        <span className="account-summary"><strong><span className="account-name" title={account?.name}>{account ? account.name : "Hesabım"}</span><SiteIcon name="chevron" size={13} /></strong><small>{account ? "B2B hesabı" : "Giriş yap"}</small></span>
      </button>
      {open && <>
        <button className="account-menu-backdrop" type="button" tabIndex={-1} aria-label="Hesap menüsünü kapat" onClick={() => { setOpen(false); trigger.current?.focus(); }} />
        <div className="account-popover" id="account-popover">
          {account ? <>
            <h3>{account.name}</h3><p>Onaylı profesyonel hesabınla devam et.</p>
            <Link className="button" href={account.role === "admin" ? "/yonetim" : "/garaj"} onClick={() => setOpen(false)}>{account.role === "admin" ? "Yönetim paneli" : "Garajım"}</Link>
            <form action={logout}><button className="button outline">Çıkış yap</button></form>
          </> : <>
            <button className="button" type="button" onClick={() => openModal("login")}>Log In</button>
            <button className="button outline" type="button" onClick={() => openModal("register")}>Register</button>
            <ul className="account-menu-benefits">
              <li><ShieldCheck size={20} /><div><b>Güvenli hesap erişimi</b><p>Servis hesabınla sana özel fiyatları görüntüle.</p></div></li>
              <li><CarFront size={20} /><div><b>Aracın her zaman elinin altında</b><p>Araç bilgilerini garajına ekleyerek kolayca ulaş.</p></div></li>
              <li><Search size={20} /><div><b>Kolay parça arama</b><p>Ürün, marka veya OEM koduyla doğru parçayı ara.</p></div></li>
            </ul>
          </>}
        </div>
      </>}
    </div>
    <AuthModal ref={modal} onClosed={() => trigger.current?.focus()} />
  </>;
}
