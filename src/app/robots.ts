import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
export default function robots(): MetadataRoute.Robots {
  if (process.env.APP_ENV === "staging") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/yonetim", "/api/", "/sepet", "/giris", "/garaj", "/servisler/basvuru"] }, sitemap: `${siteUrl}/sitemap.xml` };
}
