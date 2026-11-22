import "server-only";
import { createHash } from "node:crypto";
import { legalDocument, type LegalDocument } from "@/content/legal";

export const membershipTermsSlug = "uyelik-ve-kullanim-kosullari";
export const privacyNoticeSlug = "kvkk-aydinlatma-metni";

/** `<updatedAt>.<hash of the page>` (#1256): any edit of the page's copy changes it, so a stored acceptance names the text. */
export function legalPageVersion(slug: string, page: LegalDocument | undefined = legalDocument(slug)) {
  if (!page) throw new Error(`Legal page missing: ${slug}`);
  return `${page.updatedAt}.${createHash("sha256").update(JSON.stringify(page)).digest("hex").slice(0, 12)}`;
}
