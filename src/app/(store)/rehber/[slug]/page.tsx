import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuidePage } from "@/components/guide-page";
import { JsonLd } from "@/components/json-ld";
import { guideBySlug, guidePath, guides } from "@/content/guides";
import { defaultSocialImage, pageMetadata, siteOpenGraph, siteUrl } from "@/lib/site";
import { articleJsonLd, breadcrumbJsonLd, guideTrail } from "@/modules/seo/structured-data";

export const dynamicParams = false;

export const generateStaticParams = () => guides.map(guide => ({ slug: guide.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = guideBySlug((await params).slug);
  if (!guide) return { title: "Rehber", robots: { index: false } };
  const base = pageMetadata({ title: guide.title, description: guide.description, path: guidePath(guide.slug) });
  return { ...base, openGraph: { ...base.openGraph, ...siteOpenGraph, type: "article", publishedTime: guide.published, modifiedTime: guide.updated, images: [defaultSocialImage] } };
}

export default async function Guide({ params }: { params: Promise<{ slug: string }> }) {
  const guide = guideBySlug((await params).slug) ?? notFound();
  return <>
    <JsonLd data={articleJsonLd({ title: guide.title, description: guide.description, path: guidePath(guide.slug), published: guide.published, updated: guide.updated }, siteUrl)}/>
    <JsonLd data={breadcrumbJsonLd(guideTrail(guide), siteUrl)}/>
    <GuidePage guide={guide}/>
  </>;
}
