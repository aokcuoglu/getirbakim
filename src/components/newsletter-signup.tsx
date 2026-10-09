"use client";

import Link from "next/link";
import {useActionState} from "react";
import {subscribeNewsletter} from "@/modules/store/newsletter";
import {newsletterConsentText,type NewsletterState} from "@/modules/store/newsletter-schema";

const initialState:NewsletterState={status:"idle",message:""};

export function NewsletterSignup() {
  const [state,action,pending]=useActionState(subscribeNewsletter,initialState);
  return <section className="home-newsletter" aria-labelledby="home-newsletter-title"><div className="shell">
    <h2 id="home-newsletter-title">Kampanyalardan haberdar ol</h2>
    <form action={action} aria-label="Bülten aboneliği" aria-busy={pending}>
      <input type="email" name="email" placeholder="E-posta" aria-label="Bülten için e-posta adresin" autoComplete="email" maxLength={254} required disabled={pending}/>
      <label className="home-newsletter-consent"><input type="checkbox" name="consent" value="on" required disabled={pending}/><span>{newsletterConsentText}</span></label>
      <div className="home-newsletter-honeypot" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off"/></label></div>
      <button type="submit" disabled={pending}>{pending?"Kaydediliyor…":"Abone ol"}</button>
      <p className="home-newsletter-privacy">Verilerini nasıl işlediğimizi ve haklarını öğrenmek için <Link href="/gizlilik-politikasi">Gizlilik Politikası</Link>’nı incele.</p>
      {state.message&&<p className={"home-newsletter-message "+state.status} role={state.status==="error"?"alert":"status"}>{state.message}</p>}
    </form>
  </div></section>;
}
