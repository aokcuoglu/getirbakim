"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { consentSnapshot, parseConsent, saveConsent, subscribeConsent } from "@/lib/cookie-consent";

const serverSnapshot = () => undefined;
const focusSettings = (node: HTMLFieldSetElement | null) => node?.focus({ preventScroll: true });

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

  return <>
    <button ref={preferencesButton} type="button" className="cookie-preferences-link" onClick={openSettings}>
      Çerez tercihleri
    </button>
    {raw !== undefined && (!consent || settings) && createPortal(
      <section className="cookie-banner" aria-labelledby="cookie-title">
        <div className="cookie-banner-inner">
          <h2 id="cookie-title">Bu web sitesi çerez kullanır</h2>
          <p>
            Sitemizin çalışması, oturumunuzun korunması, sepetinizin ve araç tercihlerinizin hatırlanması için gerekli çerezleri kullanıyoruz.
            İzninizle analiz ve kişiselleştirilmiş reklamlar için ek çerezlerin kullanımına da izin verebilirsiniz.
            Tümünü kabul edebilir, ek çerezleri reddedebilir veya “Tercihleri ayarla” ile seçim yapabilirsiniz.
            Tercihinizi dilediğiniz zaman sayfanın altındaki “Çerez tercihleri” bağlantısından değiştirebilirsiniz.
            Ayrıntılar için <Link href="/bilgi/cerez-politikasi">Çerez politikamızı</Link> inceleyin.
          </p>
          {settings && <fieldset className="cookie-settings" id="cookie-settings" tabIndex={-1} ref={focusSettings}>
            <legend>Çerez tercihlerinizi ayarlayın</legend>
            <label><input type="checkbox" checked disabled /><span><strong>Gerekli çerezler</strong><small>Oturum, sepet ve garaj işlevleri için gereklidir. Her zaman aktiftir.</small></span></label>
            <label><input type="checkbox" checked={analytics} onChange={event => setAnalytics(event.target.checked)} /><span><strong>Analiz çerezleri</strong><small>Site kullanımını anlamaya yardımcı olur. Şu anda analiz hizmeti kullanılmıyor.</small></span></label>
            <label><input type="checkbox" checked={marketing} onChange={event => setMarketing(event.target.checked)} /><span><strong>Reklam ve kişiselleştirme çerezleri</strong><small>İlgi alanlarına uygun reklam ve teklifler içindir. Şu anda reklam hizmeti kullanılmıyor.</small></span></label>
          </fieldset>}
          <div className="cookie-actions">
            <button type="button" onClick={() => choose(true, true)}>Tümünü kabul et</button>
            {settings
              ? <button type="button" className="cookie-secondary" onClick={() => choose(analytics, marketing)}>Tercihleri kaydet</button>
              : <button type="button" className="cookie-secondary" aria-expanded={false} aria-controls="cookie-settings" onClick={openSettings}>Tercihleri ayarla</button>}
            <button type="button" className="cookie-secondary" onClick={() => choose(false, false)}>Tümünü reddet</button>
            {settings && consent && <button type="button" className="cookie-secondary" onClick={() => { setSettings(false); preferencesButton.current?.focus({ preventScroll: true }); }}>Vazgeç</button>}
          </div>
        </div>
      </section>, document.body
    )}
  </>;
}
