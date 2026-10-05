import { createElement, Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { legalDocument, legalLinks, legalTitle, type LegalNode } from "@/content/legal";

// Render only semantic text and links from the reviewed local content.
const allowedTags = new Set(["p", "ul", "ol", "li", "a", "span", "strong", "em", "br"]);
function renderNode(node: LegalNode, key: number): React.ReactNode {
  if (typeof node === "string") return node;
  const children = node.children.map(renderNode);
  if (!allowedTags.has(node.tag)) return <Fragment key={key}>{children}</Fragment>;
  const href = node.attrs.href;
  if (node.tag === "a") {
    if (!href || !/^(https:\/\/|mailto:|tel:|\/)/.test(href) || href.startsWith("//")) {
      return <Fragment key={key}>{children}</Fragment>;
    }
    const localHref = href.replace(/^https:\/\/getirbakim\.com\/(?:tr\/)?/, "/");
    return <Link key={key} href={localHref}>{children}</Link>;
  }
  return createElement(node.tag, { key }, ...children);
}

export function legalMetadata(slug: string): Metadata {
  const page = legalDocument(slug);
  if (!page) notFound();
  return {
    title: `${legalTitle(slug)} | Getirbakim`,
    description: page.description,
    alternates: { canonical: `/${slug}` },
  };
}

export function LegalPage({ slug }: { slug: string }) {
  const page = legalDocument(slug);
  if (!page) notFound();
  return <section className="shell page-section legal-page">
    <Link className="back" href="/">← Ana sayfa</Link>
    <div className="legal-heading">
      <p className="eyebrow">GETİRBAKİM / KURUMSAL BİLGİLER</p>
      <h1 className="page-title">{legalTitle(slug)}</h1>
      <p>{page.description}</p>
      <p className="legal-date">Son güncelleme: <time dateTime={page.updatedAt}>{page.updatedAt}</time></p>
    </div>
    <div className="legal-layout">
      <div className="legal-content">
        {["teslimat-ve-iade", "mesafeli-satis-sozlesmesi", "on-bilgilendirme-formu"].includes(slug) && <div className="legal-current-state">
          <strong>Satış Hizmetinin Durumu</strong>
          <p>İnternet üzerinden sipariş ve ödeme hizmeti henüz açık değildir. Bu sayfa genel koşulları açıklar; satış hizmeti açıldığında her sipariş için ayrıca ön bilgilendirme ve sözleşme sunulur.</p>
        </div>}
        {page.sections.map((section, index) => <article key={index} id={`bolum-${index + 1}`} className={section.title === "Kapsam ve Bilgilendirme" ? "legal-introduction" : undefined}>
          <h2>{section.title}</h2>
          {section.blocks.map(renderNode)}
        </article>)}
      </div>
      <aside className="legal-sidebar">
        <div className="legal-company"><h2>Şirket Bilgileri</h2>{page.company.map(renderNode)}</div>
        <nav aria-label="Bu sayfadaki bölümler"><h2>Bu sayfada</h2>{page.sections.map((section, index) => <a key={index} href={`#bolum-${index + 1}`}>{section.title}</a>)}</nav>
        <nav aria-label="Kurumsal ve yasal sayfalar"><h2>Diğer bilgiler</h2>{legalLinks.map(link => <Link key={link.slug} href={`/${link.slug}`} aria-current={link.slug === slug ? "page" : undefined}>{link.title}</Link>)}</nav>
      </aside>
    </div>
  </section>;
}
