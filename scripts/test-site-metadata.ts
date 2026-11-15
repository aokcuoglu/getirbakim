import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contactPhone, defaultSocialImage, pageMetadata, sellerAddress, siteJsonLd, siteOpenGraph, siteVerification, socialProfiles } from "../src/lib/site";

test("pageMetadata keeps the canonical and og:url in step and falls back to the shared image", () => {
  const meta = pageMetadata({ title: "Başlık", description: "Açıklama", path: "/bilgi/yardim" });
  assert.equal(meta.title, "Başlık");
  assert.equal(meta.alternates?.canonical, "/bilgi/yardim");
  assert.equal(meta.openGraph?.url, "/bilgi/yardim");
  assert.deepEqual(meta.openGraph?.images, [defaultSocialImage]);
  assert.equal(meta.openGraph?.siteName, siteOpenGraph.siteName);
  assert.equal(meta.openGraph?.locale, siteOpenGraph.locale);
  assert.deepEqual(pageMetadata({ title: "Marka içeren", path: "/", absoluteTitle: true }).title, { absolute: "Marka içeren" });
});

test("site verification prints a Bing tag only when a value is set", () => {
  const empty = siteVerification({});
  assert.equal(empty.google, undefined);
  assert.equal(empty.yandex, undefined);
  assert.equal(empty.other["msvalidate.01"], "");
  const full = siteVerification({ GOOGLE_SITE_VERIFICATION: "g", YANDEX_SITE_VERIFICATION: "y", BING_SITE_VERIFICATION: "b" });
  assert.deepEqual([full.google, full.yandex, full.other["msvalidate.01"]], ["g", "y", "b"]);
});

test("site JSON-LD holds one Organization and one WebSite linked to each other", () => {
  const graph = siteJsonLd["@graph"];
  const organizations = graph.filter(node => node["@type"] === "Organization");
  const sites = graph.filter(node => node["@type"] === "WebSite");
  assert.equal(organizations.length, 1);
  assert.equal(sites.length, 1);
  const site = sites[0] as { inLanguage: string; publisher: { "@id": string } };
  assert.equal(site.inLanguage, "tr-TR");
  assert.equal(site.publisher["@id"], organizations[0]["@id"]);
  assert.deepEqual((organizations[0] as { sameAs: string[] }).sameAs, Object.values(socialProfiles));
});

test("seller address and phone match the reviewed contact page", () => {
  const contact = JSON.stringify(JSON.parse(readFileSync("src/content/legal-pages.json", "utf8")).iletisim);
  assert.ok(contact.includes(sellerAddress.streetAddress));
  assert.ok(contact.includes(`tel:${contactPhone}`));
});

test("the brand suffix comes from the title template, not from page titles", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk("src/app");
  files.push("src/components/legal-page.tsx");
  const offenders = files.filter(file => readFileSync(file, "utf8").includes("| Getirbakim") && !["src/app/layout.tsx", "src/app/global-error.tsx", "src/app/yonetim/layout.tsx"].includes(file));
  assert.deepEqual(offenders, []);
});

test("the workspace layout re-declares the title template so its pages get the brand suffix", () => {
  assert.match(readFileSync("src/app/layout.tsx", "utf8"), /template:\s*"%s \| Getirbakim"/);
  assert.match(readFileSync("src/app/yonetim/layout.tsx", "utf8"), /title:\s*\{\s*default:\s*"Yönetim",\s*template:\s*"%s \| Getirbakim"\s*\}/);
});

test("pageMetadata leaves description and robots out when not given", () => {
  const meta = pageMetadata({ title: "T", path: "/x" });
  assert.equal("description" in meta, false);
  assert.equal("robots" in meta, false);
});
