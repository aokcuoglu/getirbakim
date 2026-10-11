"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { consentSnapshot, parseConsent, saveConsent, subscribeConsent } from "@/lib/cookie-consent";

const serverSnapshot = () => undefined;
const focusSettings = (node: HTMLFieldSetElement | null) => node?.focus({ preventScroll: true });

const action = "h-auto min-h-[35px] rounded-[4px] border border-primary bg-primary px-3 py-2 text-xs leading-[18px] font-semibold text-white hover:border-[#0065a9] hover:bg-[#0065a9] max-[600px]:min-h-11 max-[600px]:flex-auto";
const secondary = cn(action, "border-[#bcc6d0] bg-white font-normal text-foreground hover:border-muted-foreground hover:bg-[#f5f7f9] hover:text-foreground");
const options = [
  { key: "necessary", title: "Gerekli çerezler", text: "Oturum, sepet ve garaj işlevleri için gereklidir. Her zaman aktiftir." },
  { key: "analytics", title: "Analiz çerezleri", text: "Site kullanımını anlamaya yardımcı olur. Şu anda analiz hizmeti kullanılmıyor." },
  { key: "marketing", title: "Reklam ve kişiselleştirme çerezleri", text: "İlgi alanlarına uygun reklam ve teklifler içindir. Şu anda reklam hizmeti kullanılmıyor." },
] as const;

export function CookieConsent() {
  const raw = useSyncExternalStore(subscribeConsent, consentSnapshot, serverSnapshot);
  const consent = parseConsent(raw ?? null);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const preferencesButton = useRef<HTMLButtonElement>(null);

  function openSettings() {
    setAnalytics(consent?.analytics ?? false);
    setMarketing(consent?.marketing ?? false);
    setSettings(true);
  }

  function choose(nextAnalytics: boolean, nextMarketing: boolean) {
    saveConsent(nextAnalytics, nextMarketing);
    setSettings(false);
    preferencesButton.current?.focus({ preventScroll: true });
  }

  const checked = { necessary: true, analytics, marketing };
  const setters = { necessary: undefined, analytics: setAnalytics, marketing: setMarketing };

  return <>
    <button ref={preferencesButton} type="button" onClick={openSettings}
      className="inline min-h-6 cursor-pointer rounded-none border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] text-inherit font-normal underline underline-offset-3 hover:bg-transparent hover:text-primary">
      Çerez tercihleri
    </button>
    {raw !== undefined && (!consent || settings) && createPortal(
      <section aria-labelledby="cookie-title" className="fixed inset-x-0 bottom-0 z-90 max-h-[85dvh] overflow-y-auto overscroll-contain border-t border-[#cbd2d9] bg-white text-foreground shadow-[0_-4px_20px_#212b360d]">
        <div className="mx-auto max-w-[1404px] px-[38px] pt-[18px] pb-[calc(10px+env(safe-area-inset-bottom))] max-[600px]:p-4 max-[600px]:pb-[calc(16px+env(safe-area-inset-bottom))]">
          <h2 id="cookie-title" className="mt-0 mb-[7px] text-base leading-6 font-semibold tracking-normal">Bu web sitesi çerez kullanır</h2>
          <p className="mt-0 mb-3 text-xs leading-[21px] max-[600px]:leading-5">
            Sitemizin çalışması, oturumunuzun korunması, sepetinizin ve araç tercihlerinizin hatırlanması için gerekli çerezleri kullanıyoruz.
            İzninizle analiz ve kişiselleştirilmiş reklamlar için ek çerezlerin kullanımına da izin verebilirsiniz.
            Tümünü kabul edebilir, ek çerezleri reddedebilir veya “Tercihleri ayarla” ile seçim yapabilirsiniz.
            Tercihinizi dilediğiniz zaman sayfanın altındaki “Çerez tercihleri” bağlantısından değiştirebilirsiniz.
            Ayrıntılar için <Link href="/bilgi/cerez-politikasi" className="text-primary underline underline-offset-2">Çerez politikamızı</Link> inceleyin.
          </p>
          {settings && <fieldset id="cookie-settings" tabIndex={-1} ref={focusSettings} className="m-0 mb-3.5 grid min-w-0 gap-3.5 rounded-[4px] border border-[#dfe4e9] px-4 py-3 outline-none max-[600px]:p-2.5">
            <legend className="px-1.5 text-[13px] font-semibold">Çerez tercihlerinizi ayarlayın</legend>
            {options.map(option => <label key={option.key} className="flex cursor-pointer items-start gap-2.5">
              <Checkbox checked={checked[option.key]} disabled={option.key === "necessary"} onCheckedChange={value => setters[option.key]?.(value === true)}
                className="mt-0.5 size-[17px] min-h-0 rounded-[3px] border-[#767676] bg-white p-0 data-checked:border-primary data-checked:bg-primary data-disabled:opacity-100 data-disabled:data-checked:border-[#c4cdd5] data-disabled:data-checked:bg-[#c4cdd5]" />
              <span><strong className="block text-xs leading-5 font-semibold">{option.title}</strong><small className="block text-xs leading-[19px] text-muted-foreground">{option.text}</small></span>
            </label>)}
          </fieldset>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className={action} onClick={() => choose(true, true)}>Tümünü kabul et</Button>
            {settings
              ? <Button type="button" className={secondary} onClick={() => choose(analytics, marketing)}>Tercihleri kaydet</Button>
              : <Button type="button" className={secondary} aria-expanded={false} aria-controls="cookie-settings" onClick={openSettings}>Tercihleri ayarla</Button>}
            <Button type="button" className={secondary} onClick={() => choose(false, false)}>Tümünü reddet</Button>
            {settings && consent && <Button type="button" className={secondary} onClick={() => { setSettings(false); preferencesButton.current?.focus({ preventScroll: true }); }}>Vazgeç</Button>}
          </div>
        </div>
      </section>, document.body
    )}
  </>;
}
