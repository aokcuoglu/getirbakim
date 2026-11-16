import "server-only";
import type { Pool } from "pg";
import { BrandLogoError, prepareBrandLogo, type BrandLogoErrorReason } from "./brand-logo-upload";

/** Admin logo changes of a master brand (db/product-matching.sql brand_logos, #819). */
export type BrandLogoResult = { ok: true } | {
  ok: false; reason: "not-found" | "image";
  /** Why the file was rejected (reason "image"). */
  image?: BrandLogoErrorReason;
};
type Database = Pick<Pool, "query">;

const fileName = (name: string) => name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);

/** Sets the brand's logo from an uploaded or downloaded file; replaces an earlier logo or a hidden mark. */
export async function setBrandLogo(database: Database, brandId: string, file: { bytes: Buffer; name: string; sourceUrl?: string },
  adminId: string): Promise<BrandLogoResult> {
  if (!(await brandExists(database, brandId))) return { ok: false, reason: "not-found" };
  let logo: Awaited<ReturnType<typeof prepareBrandLogo>>;
  try { logo = await prepareBrandLogo(file.bytes); } catch (error) {
    if (error instanceof BrandLogoError) return { ok: false, reason: "image", image: error.reason };
    throw error;
  }
  const saved = await database.query(`INSERT INTO brand_logos(brand_id,image_data,sha256,width,height,source_url,file_name,updated_by)
    SELECT id,$2,$3,$4,$5,$6,$7,$8 FROM brands WHERE id=$1
    ON CONFLICT (brand_id) DO UPDATE SET image_data=EXCLUDED.image_data,sha256=EXCLUDED.sha256,width=EXCLUDED.width,
     height=EXCLUDED.height,source_url=EXCLUDED.source_url,file_name=EXCLUDED.file_name,updated_by=EXCLUDED.updated_by,updated_at=now()`,
  [brandId, logo.bytes, logo.sha256, logo.width, logo.height, (file.sourceUrl ?? "").slice(0, 2048), fileName(file.name), adminId]);
  return saved.rowCount ? { ok: true } : { ok: false, reason: "not-found" };
}

/** Shows no logo for the brand, not even an automatic one (a wrong static or enrichment logo). */
export async function hideBrandLogo(database: Database, brandId: string, adminId: string): Promise<BrandLogoResult> {
  const saved = await database.query(`INSERT INTO brand_logos(brand_id,updated_by) SELECT id,$2 FROM brands WHERE id=$1
    ON CONFLICT (brand_id) DO UPDATE SET image_data=NULL,sha256=NULL,width=NULL,height=NULL,source_url='',file_name='',
     updated_by=EXCLUDED.updated_by,updated_at=now()`, [brandId, adminId]);
  return saved.rowCount ? { ok: true } : { ok: false, reason: "not-found" };
}

/** Drops the admin's logo or hidden mark, so the brand shows its automatic logo again (if any). */
export async function resetBrandLogo(database: Database, brandId: string): Promise<BrandLogoResult> {
  if (!(await brandExists(database, brandId))) return { ok: false, reason: "not-found" };
  await database.query("DELETE FROM brand_logos WHERE brand_id=$1", [brandId]);
  return { ok: true };
}

async function brandExists(database: Database, brandId: string) {
  return Boolean((await database.query("SELECT 1 FROM brands WHERE id=$1", [brandId])).rowCount);
}
