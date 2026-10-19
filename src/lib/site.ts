export const siteUrl = (process.env.SITE_URL || "https://getirbakim.com").replace(/\/$/, "");

/** Getirbakim customer contact; the seller company keeps its own address in the legal pages. */
export const contactEmail = "hey@getirbakim.com";

export const socialProfiles = {
  x: "https://x.com/getirbakim",
  linkedin: "https://www.linkedin.com/company/getirbakim",
};

/** schema.org Organization for the home page, linking the brand to its official social profiles. */
export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Getirbakim",
  legalName: "ERGUL ENERJI SAN TIC LTD STI",
  url: siteUrl,
  logo: `${siteUrl}/brand/logo-light.png`,
  email: contactEmail,
  sameAs: Object.values(socialProfiles),
};
