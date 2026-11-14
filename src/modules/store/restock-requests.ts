import "server-only";
import {createHash} from "node:crypto";
import {db} from "@/lib/db";
import {storefrontCompanies} from "@/modules/suppliers/storefront-sources";
import {restockConsentText,restockConsentVersion,restockRequestSchema,type RestockState} from "./restock-schema";

const hashKey=(kind:string,value:string)=>`${kind}:${createHash("sha256").update(value).digest("hex")}`;
// Per hour: every request together, one address, one client address.
const limits={global:200,email:5,ip:20};

/**
 * Stores a "Gelince haber ver" request for a product no supplier sells now (commerce_unavailable_items). The product
 * is checked here, not trusted from the form; the master product is resolved for the admin's "purchasable again" check.
 * Asking again while a request is open changes nothing. No email is sent.
 */
export async function createRestockRequest(form:Record<string,unknown>,context:{accountId?:string|null;ip?:string|null}={}):Promise<RestockState>{
  const parsed=restockRequestSchema.safeParse(form);
  if(!parsed.success)return {status:"error",message:"Geçerli bir e-posta adresi gir ve bilgilendirme iznini işaretle."};
  const {productId,email}=parsed.data;
  try {
    const keys=["global",hashKey("email",email),...(context.ip?[hashKey("ip",context.ip)]:[])];
    const budget=await db.query<{key:string;attempts:number}>(`INSERT INTO restock_request_attempts AS a(key,attempts)
      SELECT unnest($1::text[]),1 ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
      window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END RETURNING key,attempts`,[keys]);
    if(budget.rows.some(row=>row.attempts>(row.key==="global"?limits.global:row.key.startsWith("email:")?limits.email:limits.ip)))
      return {status:"error",message:"Çok fazla deneme yapıldı. Bir süre sonra tekrar dene."};
    const product=(await db.query<{id:string;supplier:string;code:string;brand:string;name:string;product_id:string|null}>(`SELECT u.id,u.supplier,u.code,
      COALESCE(NULLIF(u.product_data->>'uk',''),'Belirtilmemiş') AS brand,COALESCE(NULLIF(u.product_data->>'ac',''),u.code) AS name,
      (SELECT COALESCE(p.merged_into,p.id) FROM product_sources s JOIN products p ON p.id=s.product_id WHERE s.supplier_item_id=u.id) AS product_id
      FROM commerce_unavailable_items u WHERE u.id=$2 AND u.company=ANY($1::text[])`,[storefrontCompanies(),productId])).rows[0];
    if(!product)return {status:"error",message:"Bu ürün şu an satışta; sayfayı yenileyip sepete ekleyebilirsin."};
    await db.query(`INSERT INTO restock_requests(email,supplier_item_id,product_id,supplier,code,brand,name,account_id,consent_text,consent_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [email,product.id,product.product_id,product.supplier,product.code,product.brand,product.name,context.accountId??null,restockConsentText,restockConsentVersion]);
    return {status:"success",message:"Talebin kaydedildi. Ürün yeniden satışa sunulduğunda sana bir kez haber vereceğiz."};
  }catch {
    return {status:"error",message:"Talebin şu anda kaydedilemedi. Lütfen tekrar dene."};
  }
}
