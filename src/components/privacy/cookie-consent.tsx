"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { lazyModule } from "@/lib/lazy-module";
import { consentBannerOpen, consentSnapshot, parseConsent, saveConsent, subscribeConsent, type CookieConsent as Consent } from "@/lib/cookie-consent";
import { useConsentServices, useServerConsent } from "@/components/privacy/tag-manager";

// The checkboxes (Base UI checkbox) come with the first hover, focus or click on a preferences button (#1017).
const cookieSettings = lazyModule(() => import("./cookie-settings"));
const preloadSettings = () => { void cookieSettings.preload(); };

const action = "h-auto min-h-[35px] rounded-[4px] border border-primary bg-primary px-3 py-2 text-xs leading-[18px] font-semibold text-white hover:border-[#0065a9] hover:bg-[#0065a9] max-[600px]:min-h-11 max-[600px]:flex-auto";
const secondary = cn(action, "border-[#bcc6d0] bg-white font-normal text-foreground hover:border-muted-foreground hover:bg-[#f5f7f9] hover:text-foreground");
const optionTexts = {
  necessary: { title: "Gerekli çerezler", text: "Oturum, sepet ve garaj işlevleri için gereklidir. Her zaman aktiftir." },
  analytics: {
    title: "Analiz çerezleri",
    text: "Ziyaret ve alışveriş adımlarını ölçmek için Google Analytics kullanılır. Yalnızca izin verirsen yüklenir.",
    idle: "Site kullanımını anlamaya yardımcı olur. Şu anda analiz hizmeti kullanılmıyor.",
  },
  marketing: {
    title: "Reklam ve kişiselleştirme çerezleri",
    text: (names: string[]) => `Reklamların etkisini ölçmek için ${names.join(" ve ")} kullanılır. Yalnızca izin verirsen yüklenir.`,
    idle: "Reklamların etkisini ölçmek içindir. Şu anda reklam hizmeti kullanılmıyor.",
  },
};

// The footer button and the banner live in different trees (footer vs. after it), so "preferences open" is a small shared store.
let settingsOpen = false;
let opener: HTMLElement | null = null;
const settingsListeners = new Set<() => void>();
const subscribeSettings = (callback: () => void) => { settingsListeners.add(callback); return () => { settingsListeners.delete(callback); }; };
const settingsSnapshot = () => settingsOpen;
const settingsServerSnapshot = () => false;
function setSettings(open: boolean) {
  settingsOpen = open;
  for (const listener of settingsListeners) listener();
}

function openCookieSettings(trigger: HTMLElement | null) {
  opener = trigger;
  setSettings(true);
  // A failed download closes the panel again (focus back on the opener); the next click retries.
  cookieSettings.preload().catch(() => closeCookieSettings());
}

/**
 * Closes the preferences and returns focus to the button that opened them: the footer's "Çerez tercihleri", or the banner's
 * "Tercihleri ayarla" when the banner stays (no choice yet; the panel re-renders it). Once the banner is gone, the footer button.
 */
function closeCookieSettings() {
  const footer = opener;
  opener = null;
  setSettings(false);
  // After the commit: the banner's button is a new element, rendered by the closing update.
  requestAnimationFrame(() => {
    const target = footer?.isConnected ? footer
      : document.querySelector<HTMLElement>("[data-cookie-settings-opener]") ?? document.querySelector<HTMLElement>("[data-cookie-preferences]");
    target?.focus({ preventScroll: true });
  });
}

/** The footer's "Çerez tercihleri" link-styled button; the banner itself is <CookieBanner/>. */
export function CookieConsent() {
  return <button type="button" data-cookie-preferences="" onPointerEnter={preloadSettings} onFocus={preloadSettings} onClick={event => openCookieSettings(event.currentTarget)}
    className="inline min-h-6 cursor-pointer rounded-none border-0 bg-transparent p-0 text-[length:inherit] leading-[inherit] text-inherit font-normal underline underline-offset-3 hover:bg-transparent hover:text-primary">
    Çerez tercihleri
  </button>;
}

/**
 * The consent banner, rendered on the server from the request's cookie (#736): a first visit gets it in the HTML instead of
 * after hydration, so it neither shifts nor becomes the late LCP element. Fixed to the viewport, rendered after the footer.
 */
export function CookieBanner() {
  const serverConsent = useServerConsent();
  const raw = useSyncExternalStore(subscribeConsent, consentSnapshot, () => serverConsent);
  const settings = useSyncExternalStore(subscribeSettings, settingsSnapshot, settingsServerSnapshot);

  useEffect(() => {
    if (!settings) return;
    // Escape closes the panel like "Vazgeç" and returns focus to the button that opened it.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeCookieSettings(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settings]);

  if (!consentBannerOpen(raw, settings)) return null;
  // Keyed by mode: opening the preferences starts the checkboxes from the saved choice.
  return <BannerPanel key={settings ? "settings" : "notice"} settings={settings} consent={parseConsent(raw)}/>;
}

function BannerPanel({ settings, consent }: { settings: boolean; consent: Consent | null }) {
  const services = useConsentServices();
  const fields = cookieSettings.useModule();
  const options = [
    { key: "necessary", ...optionTexts.necessary },
    { key: "analytics", title: optionTexts.analytics.title, text: services.analytics ? optionTexts.analytics.text : optionTexts.analytics.idle },
    { key: "marketing", title: optionTexts.marketing.title, text: services.marketing ? optionTexts.marketing.text(services.marketingNames) : optionTexts.marketing.idle },
  ] as const;
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);

  function choose(nextAnalytics: boolean, nextMarketing: boolean) {
    // A category without a service is saved as refused, so turning one on later asks again (CONSENT_VERSION).
    saveConsent(nextAnalytics, nextMarketing && services.marketing);
    closeCookieSettings();
  }

  const checked = { necessary: true, analytics, marketing };
  const setters = { necessary: undefined, analytics: setAnalytics, marketing: setMarketing };

  return <section data-nosnippet="" aria-labelledby="cookie-title" className="fixed inset-x-0 bottom-0 z-90 max-h-[85dvh] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] overflow-y-auto overscroll-contain border-t border-[#cbd2d9] bg-white text-foreground shadow-[0_-4px_20px_#212b360d]">
    <div className="mx-auto max-w-[1404px] px-[38px] pt-[18px] pb-[calc(10px+env(safe-area-inset-bottom))] max-[600px]:p-4 max-[600px]:pb-[calc(16px+env(safe-area-inset-bottom))]">
      <h2 id="cookie-title" className="mt-0 mb-[7px] text-base leading-6 font-semibold tracking-normal">Bu web sitesi çerez kullanır</h2>
      <p className="mt-0 mb-3 text-xs leading-[21px] max-[600px]:leading-5">
        Sitemizin çalışması, sepetinizin ve araç tercihlerinizin hatırlanması için gerekli çerezleri kullanıyoruz.
        Analiz ve reklam çerezleri yalnızca izin vermeniz hâlinde etkinleşir; tercihinizi sayfanın altındaki “Çerez tercihleri” bağlantısından değiştirebilirsiniz.
        Ayrıntılar için <Link href="/bilgi/cerez-politikasi" className="text-primary underline underline-offset-2">Çerez politikamızı</Link> inceleyin.
      </p>
      {settings && fields && <fields.CookieSettings options={options} checked={checked} setters={setters} />}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={action} onClick={() => choose(true, true)}>Tümünü kabul et</Button>
        {settings
          ? <Button type="button" className={secondary} disabled={!fields} onClick={() => choose(analytics, marketing)}>Tercihleri kaydet</Button>
          : <Button type="button" className={secondary} data-cookie-settings-opener="" aria-expanded={false} aria-controls="cookie-settings" onPointerEnter={preloadSettings} onFocus={preloadSettings} onClick={() => openCookieSettings(null)}>Tercihleri ayarla</Button>}
        <Button type="button" className={secondary} onClick={() => choose(false, false)}>Tümünü reddet</Button>
        {settings && consent && <Button type="button" className={secondary} onClick={closeCookieSettings}>Vazgeç</Button>}
      </div>
    </div>
  </section>;
}
