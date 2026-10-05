"use client";

import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { BadgePercent, Clock3, Route, X } from "lucide-react";
import { login } from "@/modules/auth/actions";

export type AuthMode = "login" | "register" | "reset";

const benefits = [
  { icon: Clock3, title: "Daha hızlı alışveriş", description: "Hesabınla sepetine kolayca ulaş, alışverişine kaldığın yerden devam et." },
  { icon: Route, title: "Aracın hep elinin altında", description: "Araç bilgilerini garajına kaydet, sonraki ziyaretlerinde kolayca ulaş." },
  { icon: BadgePercent, title: "Sana özel fiyatlar", description: "Onaylı servis hesabınla profesyonellere özel B2B fiyatlarını görüntüle." },
];

function AuthField({ name, label, type = "text", autoComplete, full = false }: {
  name: string; label: string; type?: string; autoComplete: string; full?: boolean;
}) {
  return <label className={`auth-field${full ? " auth-field-full" : ""}`}>
    <input name={name} type={type} placeholder=" " autoComplete={autoComplete} required
      minLength={name === "newPassword" ? 8 : undefined}
      maxLength={type === "password" ? 72 : 200}
      onInput={event => {
        if (name === "confirmPassword" || name === "newPassword") {
          const form = event.currentTarget.form;
          const password = form?.elements.namedItem("newPassword") as HTMLInputElement | null;
          const confirmation = form?.elements.namedItem("confirmPassword") as HTMLInputElement | null;
          confirmation?.setCustomValidity(confirmation.value && confirmation.value !== password?.value ? "Şifreler eşleşmiyor." : "");
        }
      }} />
    <span>{label} <em>*</em></span>
  </label>;
}

function LoginSubmit() {
  const { pending } = useFormStatus();
  return <button className="auth-submit" type="submit" disabled={pending}>{pending ? "Giriş yapılıyor…" : "Giriş yap"}</button>;
}

export function AuthModal({ ref, onClosed }: { ref: Ref<{ open: (mode: AuthMode) => void }>; onClosed: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [notice, setNotice] = useState("");

  useImperativeHandle(ref, () => ({ open(nextMode) {
    setNotice(""); setMode(nextMode); dialog.current?.showModal();
  } }), []);

  useEffect(() => {
    if (!mode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mode]);

  function switchMode(nextMode: AuthMode) { setNotice(""); setMode(nextMode); }
  function previewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(mode === "register" ? "Yeni üyelik kaydı henüz açılmadı. Servis hesabı için yardım merkezinden bilgi alabilirsin." : "Şifre yenileme henüz açılmadı. Servis hesabın için yardım merkezinden bilgi alabilirsin.");
  }

  return <dialog ref={dialog} className="auth-modal" aria-labelledby="auth-title" onClose={() => { setMode(null); setNotice(""); onClosed(); }} onClick={event => {
    if (event.target !== dialog.current) return;
    const bounds = dialog.current.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current.close();
  }}>
    {mode && <div className="auth-layout">
      <aside className="auth-benefits">
        <h2>Hesabınla daha fazlası</h2>
        <ul>{benefits.map(({ icon: Icon, title, description }) => <li key={title}>
          <span className="auth-benefit-icon"><Icon size={32} strokeWidth={1.5} /></span>
          <div><h3>{title}</h3><p>{description}</p></div>
        </li>)}</ul>
      </aside>
      <section className="auth-panel">
        <button className="auth-close" type="button" aria-label="Kapat" onClick={() => dialog.current?.close()}><X size={20} /></button>
        <h2 id="auth-title">{mode === "register" ? "Kayıt ol" : mode === "reset" ? "Şifreni yenile" : "Giriş yap"}</h2>
        <div className="auth-content">
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          {mode === "login" ? <form action={login} key="login" className="auth-form">
            <div className="auth-fields"><AuthField name="email" label="E-posta adresi" type="email" autoComplete="username" /><AuthField name="password" label="Şifre" type="password" autoComplete="current-password" /></div>
            <button type="button" className="auth-link auth-forgot" onClick={() => switchMode("reset")}>Şifreni mi unuttun?</button>
            <LoginSubmit />
          </form> : mode === "register" ? <div className="auth-form"><p>Servis bilgilerinle başvur; onaydan sonra B2B fiyatlarına ulaş.</p><Link className="button" href="/servisler/basvuru" onClick={() => dialog.current?.close()}>Servis hesabına başvur</Link></div> : <form key="reset" className="auth-form" onSubmit={previewSubmit}>
            <p className="auth-reset-copy">Hesabına kayıtlı e-posta adresini gir.</p>
            <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" />
            <button className="auth-submit" type="submit">Şifremi yenile</button>
          </form>}
          <p className="auth-reset-copy"><Link className="auth-link" href="/kvkk-aydinlatma-metni" onClick={() => dialog.current?.close()}>KVKK Aydınlatma Metni</Link></p>
          <p className="auth-switch">{mode === "register" ? <>Zaten hesabın var mı? <button className="auth-link" type="button" onClick={() => switchMode("login")}>Giriş yap</button></> : mode === "reset" ? <button className="auth-link" type="button" onClick={() => switchMode("login")}>Giriş ekranına dön</button> : <>Henüz hesabın yok mu? <button className="auth-link" type="button" onClick={() => switchMode("register")}>Kayıt ol</button></>}</p>
        </div>
      </section>
    </div>}
  </dialog>;
}
