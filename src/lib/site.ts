import type { Metadata } from "next";

export const siteUrl = (process.env.SITE_URL || "https://getirbakim.com").replace(/\/$/, "");

/** Getirbakim customer contact; the seller company keeps its own address in the legal pages. */
export const contactEmail = "hey@getirbakim.com";

/**
 * The site-wide Open Graph fields. A page that sets its own openGraph replaces the layout's object as a whole, so it
 * spreads these back in (#595).
 */
export const siteOpenGraph = { siteName: "Getirbakim", locale: "tr_TR", type: "website" } as const;
export const defaultSocialImage = { url: "/brand/social-getirbakim.png", width: 1080, height: 1080, alt: "Getirbakim — Bir bakalım, doğru parçayı bulalım." };

export const socialProfiles = {
  x: "https://x.com/getirbakim",
  linkedin: "https://www.linkedin.com/company/getirbakim",
};

export const siteName = "Getirbakim";
export const siteDescription = "Aracın için, parçadan anlayan insanların yedek parça mağazası. Bir bakalım, doğru parçayı bulalım.";
export const contactPhone = "+902163870078";

/** The seller's address, as printed under "Adres ve İade Noktası" in src/content/legal-pages.json. */
export const sellerAddress = {
  streetAddress: "Esentepe Mahallesi, Kartal Oto Sanayi Sitesi, C1 Blok, No: 25",
  addressLocality: "Kartal",
  addressRegion: "İstanbul",
  addressCountry: "TR",
};

export const servicesSocialImage = { url: "/brand/social-servisler.png", width: 1080, height: 1080, alt: "Servisler için Getirbakim" };

/** Search engine ownership tags; an empty value prints no tag. */
export function siteVerification(env: Record<string, string | undefined> = process.env) {
  return {
    google: env.GOOGLE_SITE_VERIFICATION,
    yandex: env.YANDEX_SITE_VERIFICATION,
    other: { "msvalidate.01": env.BING_SITE_VERIFICATION ?? "" },
  };
}

type PageMetadataInput = {
  title: string;
  description?: string;
  path: string;
  /** Skips the layout's title template (the brand is already inside the title). */
  absoluteTitle?: boolean;
  image?: typeof defaultSocialImage;
  robots?: Metadata["robots"];
};

/** Title, description, canonical and Open Graph url of one page, kept in step (#636). The title takes the layout's brand suffix. */
export function pageMetadata({ title, description, path, absoluteTitle, image, robots }: PageMetadataInput): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { ...siteOpenGraph, url: path, images: [image ?? defaultSocialImage] },
    robots,
  };
}

const organizationId = `${siteUrl}/#organization`;

/** schema.org Organization and WebSite, printed once by the storefront layout. */
export const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: siteName,
      legalName: "ERGUL ENERJI SAN TIC LTD STI",
      url: siteUrl,
      logo: `${siteUrl}/brand/logo-light.png`,
      email: contactEmail,
      telephone: contactPhone,
      address: { "@type": "PostalAddress", ...sellerAddress },
      contactPoint: { "@type": "ContactPoint", contactType: "customer service", telephone: contactPhone, email: contactEmail, areaServed: "TR", availableLanguage: "tr" },
      sameAs: Object.values(socialProfiles),
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: siteName,
      alternateName: ["GETİRBAKİM", "getirbakim.com"],
      url: siteUrl,
      inLanguage: "tr-TR",
      publisher: { "@id": organizationId },
    },
  ],
};
