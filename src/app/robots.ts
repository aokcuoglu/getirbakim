import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { robotsPolicy } from "@/modules/seo/crawlers";

export default function robots(): MetadataRoute.Robots {
  return robotsPolicy({ staging: process.env.APP_ENV === "staging", site: siteUrl });
}
