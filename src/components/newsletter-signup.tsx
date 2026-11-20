"use client";

import Link from "next/link";
import {useActionState} from "react";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Input} from "@/components/ui/input";
import {checkoutCheckbox} from "@/components/checkout-field-classes";
import {storeButton} from "@/components/store-button";
import {cn} from "@/lib/utils";
import {subscribeNewsletter} from "@/modules/store/newsletter";
import {newsletterConsentText,type NewsletterState} from "@/modules/store/newsletter-consent";

const initialState:NewsletterState={status:"idle",message:""};

export function NewsletterSignup() {
  const [state,action,pending]=useActionState(subscribeNewsletter,initialState);
  return <section className="min-h-[346px] bg-[linear-gradient(#212b36b3,#212b36b3),url('/media/site/images/home-footer-bg.webp')] bg-cover bg-center bg-no-repeat pt-[65px] pb-20 text-white max-md:min-h-0 max-md:pt-12 max-md:pb-14" aria-labelledby="home-newsletter-title"><div className="mx-auto w-full max-w-[1350px] px-[15px]">
    <h2 id="home-newsletter-title" className="mb-3.5 text-center text-xl leading-[26px] font-semibold tracking-[-.3px]">Kampanyalardan haberdar ol</h2>
    <form action={action} aria-label="Bülten aboneliği" aria-busy={pending} className="relative mx-auto flex max-w-[400px] flex-col">
      <Input type="email" name="email" placeholder="E-posta" aria-label="Bülten için e-posta adresin" autoComplete="email" maxLength={254} required disabled={pending} className="h-11 min-h-0 rounded-lg border-control-border bg-white px-3 py-2.5 text-base leading-6 text-foreground md:text-base disabled:bg-white"/>
      <label className="mt-3.5 mb-3 flex items-start gap-2.5 text-left text-xs leading-[18px] text-white"><Checkbox name="consent" value="on" required disabled={pending} className={cn(checkoutCheckbox,"border-white bg-white")}/><span>{newsletterConsentText}</span></label>
      <div className="absolute size-px overflow-hidden [clip-path:inset(50%)]" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off"/></label></div>
      <Button type="submit" disabled={pending} className={cn(storeButton({intent:"primary",size:"md"}),"w-full disabled:cursor-wait")}>{pending?"Kaydediliyor…":"Abone ol"}</Button>
      <p className="mt-2 text-center text-xs leading-[18px] text-white">Verilerini nasıl işlediğimizi ve haklarını öğrenmek için <Link href="/gizlilik-politikasi" className="text-white underline underline-offset-2">Gizlilik Politikası</Link>’nı incele.</p>
      {state.message&&<p className={cn("mt-3 rounded-[4px] bg-white/93 px-3 py-2.5 text-center text-[13px] leading-[18px]",state.status==="error"?"text-[#9b2626]":"text-foreground")} role={state.status==="error"?"alert":"status"}>{state.message}</p>}
    </form>
  </div></section>;
}
