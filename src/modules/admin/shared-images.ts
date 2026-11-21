import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { placeholderListStatus, sharedImageDetail, sharedImagesPage, type DetailParams, type ListParams } from "@/modules/admin/shared-images-query";

export { minPartsOptions } from "@/modules/admin/shared-images-query";

export async function listSharedImages(params: ListParams) {
  await requireAdmin();
  return sharedImagesPage(db, params, storefrontCompanies());
}

export async function loadSharedImage(id: string, params: DetailParams) {
  await requireAdmin();
  return sharedImageDetail(db, id, params, storefrontCompanies());
}

export async function listPlaceholderImages() {
  await requireAdmin();
  return placeholderListStatus(db, storefrontCompanies());
}
