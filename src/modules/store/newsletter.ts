"use server";

import {createHash} from "node:crypto";
import {db} from "@/lib/db";
import {newsletterConsentText,newsletterConsentVersion,newsletterSchema,type NewsletterState} from "./newsletter-schema";

export async function subscribeNewsletter(_previous:NewsletterState,form:FormData):Promise<NewsletterState> {
  const parsed=newsletterSchema.safeParse({email:form.get("email"),consent:form.get("consent"),website:form.get("website")??""});
  if(!parsed.success)return {status:"error",message:"Geçerli bir e-posta adresi gir ve e-posta alma iznini işaretle."};
  const key=createHash("sha256").update(parsed.data.email).digest("hex");
  try {
    const budget=await db.query<{key:string;attempts:number}>(`INSERT INTO newsletter_subscription_attempts AS a(key,attempts)
      VALUES('global',1),($1,1) ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
      window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END RETURNING key,attempts`,[key]);
    if(budget.rows.some(row=>row.attempts>(row.key==="global"?100:3)))return {status:"error",message:"Çok fazla deneme yapıldı. Bir süre sonra tekrar dene."};
    await db.query(`INSERT INTO newsletter_subscriptions(email,consent_text,consent_version,source)
      VALUES($1,$2,$3,'homepage') ON CONFLICT(email) DO NOTHING`,[parsed.data.email,newsletterConsentText,newsletterConsentVersion]);
    // A request is not an email-verified subscription; no mailing service is invoked here.
    return {status:"success",message:"Bülten abonelik talebin kaydedildi."};
  }catch {
    return {status:"error",message:"Talebin şu anda kaydedilemedi. Lütfen tekrar dene."};
  }
}
