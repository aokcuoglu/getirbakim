"use client";

import Link from "next/link";
import { useImperativeHandle, useRef, useState, type Ref, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { BadgePercent, Clock3, Route, X } from "lucide-react";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { login } from "@/modules/auth/actions";

export type AuthMode = "login" | "register" | "reset";

const benefits = [
  { icon: Clock3, title: "Daha hızlı alışveriş", description: "Hesabınla sepetine kolayca ulaş, alışverişine kaldığın yerden devam et." },
  { icon: Route, title: "Aracın hep elinin altında", description: "Araç bilgilerini garajına kaydet, sonraki ziyaretlerinde kolayca ulaş." },
  { icon: BadgePercent, title: "Sana özel fiyatlar", description: "Onaylı servis hesabınla profesyonellere özel B2B fiyatlarını görüntüle." },
];

const linkButton = "inline h-auto min-h-0 rounded-none border-0 bg-transparent p-0 text-left text-[length:inherit] leading-[inherit] font-medium text-brand hover:bg-transparent hover:text-brand-strong hover:underline";
const submitButton = "mt-6 h-auto min-h-12 w-full rounded-lg border border-brand bg-brand px-[27px] py-[13px] text-sm leading-5 font-medium text-white hover:border-brand-strong hover:bg-brand-strong active:bg-[#005a9f] disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-[#98a4af] disabled:opacity-100";

function AuthField({ name, label, type = "text", autoComplete }: {
  name: string; label: string; type?: string; autoComplete: string;
}) {
  return <label className="relative block min-w-0">
    <input name={name} type={type} placeholder=" " autoComplete={autoComplete} required
      minLength={name === "newPassword" ? 8 : undefined}
      maxLength={type === "password" ? 72 : 200}
      className="peer block h-12 min-h-12 w-full rounded-lg border border-input bg-white px-[11px] pt-[17px] pb-[5px] text-sm leading-5 text-foreground transition-colors outline-none focus:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#377db7] placeholder:text-transparent"
      onInput={event => {
        if (name === "confirmPassword" || name === "newPassword") {
          const form = event.currentTarget.form;
          const password = form?.elements.namedItem("newPassword") as HTMLInputElement | null;
          const confirmation = form?.elements.namedItem("confirmPassword") as HTMLInputElement | null;
          confirmation?.setCustomValidity(confirmation.value && confirmation.value !== password?.value ? "Şifreler eşleşmiyor." : "");
        }
      }} />
    <span className="pointer-events-none absolute top-3.5 left-3 max-w-[calc(100%-24px)] text-sm leading-5 whitespace-nowrap text-muted-foreground transition-all duration-150 peer-focus:top-1 peer-focus:text-[10px] peer-focus:leading-[14px] peer-[:not(:placeholder-shown)]:top-1 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:leading-[14px] motion-reduce:transition-none">
      {label} <em className="text-[#d72b2b] not-italic">*</em>
    </span>
  </label>;
}

function LoginSubmit() {
  const { pending } = useFormStatus();
  return <Button className={submitButton} type="submit" disabled={pending}>{pending ? "Giriş yapılıyor…" : "Giriş yap"}</Button>;
}

export function AuthModal({ ref, onClosed }: { ref: Ref<{ open: (mode: AuthMode) => void }>; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  // Kept after closing so the panel does not empty out during the closing animation.
  const [mode, setMode] = useState<AuthMode>("login");
  const [notice, setNotice] = useState("");
  const popup = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ open(nextMode) { setNotice(""); setMode(nextMode); setOpen(true); } }), []);

  function close() { setOpen(false); }
  function switchMode(nextMode: AuthMode) { setNotice(""); setMode(nextMode); }
  function previewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(mode === "register" ? "Servis hesapları başvuruyla açılır. Servisler sayfasından başvurabilir veya hey@getirbakim.com adresine yazabilirsin." : "Şifreni yenilemek için kayıtlı e-posta adresinden hey@getirbakim.com adresine yazabilirsin.");
  }

  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }} onOpenChangeComplete={next => { if (!next) { setNotice(""); onClosed(); } }}>
    <DialogPortal>
      <DialogOverlay className="bg-[rgba(33,43,54,.5)] supports-backdrop-filter:backdrop-blur-none" />
      <DialogPrimitive.Popup ref={popup} initialFocus={() => popup.current?.querySelector<HTMLInputElement>("input") ?? true} finalFocus={false}
        className="fixed inset-0 z-50 m-auto h-fit max-h-[calc(100dvh-48px)] w-[1020px] max-w-[calc(100vw-48px)] overflow-auto overscroll-contain rounded-xl bg-white p-0 text-sm leading-5 text-foreground outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 max-[700px]:h-dvh max-[700px]:max-h-dvh max-[700px]:w-full max-[700px]:max-w-[100vw] max-[700px]:rounded-none">
        <div className="grid min-h-[622px] grid-cols-2 max-[700px]:block max-[700px]:min-h-full">
          <aside className="flex flex-col justify-center bg-[url('/media/site/images/register-img-v2.webp')] bg-cover bg-center p-12 text-white max-[1000px]:p-8 max-[700px]:hidden">
            <h2 className="mt-0 mb-10 text-2xl leading-8 font-semibold tracking-[-.5px] max-[1000px]:text-[21px] max-[1000px]:leading-[29px]">Hesabınla daha fazlası</h2>
            <ul className="m-0 flex list-none flex-col gap-8 p-0">{benefits.map(({ icon: Icon, title, description }) => <li key={title} className="flex items-start gap-4">
              <span className="flex h-12 flex-[0_0_48px] items-center justify-center rounded-md bg-white/16"><Icon size={32} strokeWidth={1.5} /></span>
              <div><h3 className="m-0 text-base leading-6 font-semibold">{title}</h3><p className="mt-2 mb-0 text-sm leading-5 text-white/80">{description}</p></div>
            </li>)}</ul>
          </aside>
          <section className="relative min-w-0 px-8 pt-6 pb-8 max-[700px]:mx-auto max-[700px]:w-full max-[700px]:max-w-[452px] max-[700px]:px-5 max-[700px]:pt-7 max-[700px]:pb-10 max-[370px]:px-4">
            <DialogClose aria-label="Kapat" className="absolute top-2.5 right-2.5 flex size-8 min-h-8 items-center justify-center rounded-md border-0 bg-[#e6e9ec] p-0 text-foreground hover:bg-[#dfe3e8] max-[700px]:top-5 max-[700px]:right-4"><X size={20} /></DialogClose>
            <DialogTitle className="m-0 pr-7 text-[26px] leading-[34px] font-semibold max-[700px]:text-2xl max-[700px]:leading-8">{mode === "register" ? "Kayıt ol" : mode === "reset" ? "Şifreni yenile" : "Giriş yap"}</DialogTitle>
            <div className="mt-10 max-[700px]:mt-8">
              {notice && <p className="mt-0 mb-4 rounded-md border border-[#c9dfef] bg-[#f0f6fb] p-3 text-[13px] leading-5" role="status">{notice}</p>}
              {mode === "login" ? <form action={login} key="login">
                <div className="grid gap-3"><AuthField name="email" label="E-posta adresi" type="email" autoComplete="username" /><AuthField name="password" label="Şifre" type="password" autoComplete="current-password" /></div>
                <Button type="button" className={`${linkButton} mt-3 block text-[13px] leading-5`} onClick={() => switchMode("reset")}>Şifreni mi unuttun?</Button>
                <LoginSubmit />
              </form> : mode === "register" ? <div>
                <p className="mt-0 mb-3.5">Servis bilgilerinle başvur; onaydan sonra B2B fiyatlarına ulaş.</p>
                <Button nativeButton={false} className="h-auto min-h-12 rounded-lg border border-brand bg-brand px-[27px] py-[13px] text-sm leading-5 font-medium text-white hover:bg-brand-strong" render={<Link href="/servisler/basvuru" onClick={close} />}>Servis hesabına başvur</Button>
              </div> : <form key="reset" onSubmit={previewSubmit}>
                <p className="mt-0 mb-6 text-sm leading-[22px] text-muted-foreground">Hesabına kayıtlı e-posta adresini gir.</p>
                <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" />
                <Button className={submitButton} type="submit">Şifremi yenile</Button>
              </form>}
              <p className="mt-0 mb-6 text-sm leading-[22px] text-muted-foreground"><Link className="font-medium text-brand hover:text-brand-strong hover:underline" href="/kvkk-aydinlatma-metni" onClick={close}>KVKK Aydınlatma Metni</Link></p>
              <p className="mt-4 mb-0 text-center text-sm leading-[22px]">{mode === "register" ? <>Zaten hesabın var mı? <Button type="button" className={linkButton} onClick={() => switchMode("login")}>Giriş yap</Button></> : mode === "reset" ? <Button type="button" className={linkButton} onClick={() => switchMode("login")}>Giriş ekranına dön</Button> : <>Henüz hesabın yok mu? <Button type="button" className={linkButton} onClick={() => switchMode("register")}>Kayıt ol</Button></>}</p>
            </div>
          </section>
        </div>
      </DialogPrimitive.Popup>
    </DialogPortal>
  </Dialog>;
}
