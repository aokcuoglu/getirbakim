// Kept apart from checkout-schema so the checkout form can show these without bundling zod.

/**
 * What to fix when the server refuses a field (#881), by the first refused field's name; the page shows it instead of the
 * general validation text. Fields without an entry keep the general text.
 */
export const checkoutFieldErrors:Record<string,string>={
 name:"Ad soyadını yaz.",email:"Geçerli bir e-posta adresi yaz.",phone:"Telefon numarasını kontrol et.",
 province:"Teslimat ili seç.",district:"Seçili ile ait bir ilçe seç.",addressLine:"Açık adresi en az 10 karakterle yaz.",
 postalCode:"Posta kodu seçili ille uyuşmuyor; 5 haneli ve ilin plaka koduyla başlamalı ya da boş kalmalı.",
 invoiceType:"Fatura türünü seç.",invoiceCompany:"Fatura unvanını yaz.",invoiceTaxNo:"Şirketler için 10 haneli VKN, şahıs işletmeleri için geçerli 11 haneli TC kimlik no gir.",invoiceTaxOffice:"Vergi dairesini yaz.",
 consent:"Ön bilgilendirme formunu ve mesafeli satış sözleşmesini onayla.",
};

/** The first refused field that has its own message, if any. */
export function checkoutErrorField(issues:readonly {path:readonly PropertyKey[]}[]) {
 const field=issues.map(issue=>issue.path[0]).find(key=>typeof key==="string" && Object.hasOwn(checkoutFieldErrors,key));
 return typeof field==="string" ? field : undefined;
}
