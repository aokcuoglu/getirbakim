"use client";

import Link from "next/link";
import {useActionState} from "react";
import {BellRing} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Input} from "@/components/ui/input";
import {requestRestock} from "@/modules/store/restock";
import {restockConsentText,type RestockState} from "@/modules/store/restock-consent";
import {storeButton} from "@/components/store-button";
import {cn} from "@/lib/utils";

const initialState:RestockState={status:"idle",message:""};

/**
 * "Gelince haber ver" (#475) on the page of a product no supplier sells now; `email` prefills a signed-in shopper's address.
 * `priceOnly`: a Dinamik price-list-only code (#1068) waits for stock data, not for a supplier to offer it again. Only the
 * description changes; the consent text and the success message stay (restockConsentVersion).
 */
export function RestockRequestForm({productId,email,priceOnly=false}:{productId:string;email?:string;priceOnly?:boolean}) {
  const [state,action,pending]=useActionState(requestRestock,initialState);
  return <section id="haber-ver" className="mb-5 scroll-mt-[110px] rounded-[5px] border border-[#dbe0e6] p-5 max-[750px]:p-4" aria-labelledby="haber-ver-title">
    <h2 id="haber-ver-title" className="mb-1 flex items-center gap-2 text-base leading-6 font-semibold"><BellRing size={18} className="shrink-0"/>Gelince haber ver</h2>
    <p className="mb-4 text-[13px] leading-5 text-[#53677d]">{priceOnly?"Stok bilgisi geldiğinde e-posta adresine bir kez haber verelim.":"Ürün yeniden satışa sunulduğunda e-posta adresine bir kez bilgi verelim."}</p>
    {state.status==="success"?<p className="rounded-[4px] bg-[#e8f4ec] px-3 py-2.5 text-[13px] leading-5 text-[#1e5e3e]" role="status">{state.message}</p>
    :<form action={action} aria-busy={pending} className="relative flex flex-col gap-3">
      <input type="hidden" name="productId" value={productId}/>
      <div className="flex gap-2.5 max-[600px]:flex-col">
        <Input type="email" name="email" defaultValue={email} placeholder="E-posta adresin" aria-label="Haber verilecek e-posta adresi" autoComplete="email" maxLength={254} required disabled={pending}
          className="h-12 min-w-0 flex-1 rounded-[5px] bg-white px-3 text-sm"/>
        <Button type="submit" disabled={pending} className={cn(storeButton({intent:"primary",size:"lg"}),"px-6 disabled:cursor-wait")}>{pending?"Kaydediliyor…":"Haber ver"}</Button>
      </div>
      <label className="flex items-start gap-2 text-xs leading-[18px] text-[#53677d]"><Checkbox name="consent" value="on" required disabled={pending} className="mt-0.5"/><span>{restockConsentText} <Link href="/gizlilik-politikasi" className="underline underline-offset-2 hover:text-[#0065c3]">Gizlilik Politikası</Link></span></label>
      <div className="absolute size-px overflow-hidden [clip-path:inset(50%)]" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off"/></label></div>
      {state.status==="error"&&<p className="text-[13px] leading-5 text-[#ae3025]" role="alert">{state.message}</p>}
    </form>}
  </section>;
}
