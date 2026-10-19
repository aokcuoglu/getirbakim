import { createElement, Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
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
  const box = "rounded-md border border-border bg-[#f7f9fb] p-[22px] max-[600px]:p-[18px]";
  const card = "rounded-md border border-border p-[22px] max-[600px]:p-[18px]";
  const heading = "m-0 mb-3.5 text-[19px] leading-[1.5] font-semibold";
  return <section className="mx-auto min-h-[55vh] w-full max-w-[1200px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10 [&_a:not([data-back])]:text-primary [&_a:not([data-back])]:underline [&_a:not([data-back])]:underline-offset-3 [&_a:not([data-back])]:wrap-anywhere">
    <Link data-back href="/" className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary">← Ana sayfa</Link>
    <div className="mb-8 max-w-[780px] max-[600px]:mb-6">
      <p className="mb-2 block text-base leading-[1.8] font-medium tracking-[1.2px] text-muted-foreground">GETİRBAKİM / KURUMSAL BİLGİLER</p>
      <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{legalTitle(slug)}</h1>
      <p className="text-base leading-[1.8] text-muted-foreground">{page.description}</p>
      <p className="mt-4 text-xs leading-[1.8] text-muted-foreground">Son güncelleme: <time dateTime={page.updatedAt}>{page.updatedAt}</time></p>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_310px] items-start gap-12 max-[850px]:grid-cols-1 max-[850px]:gap-6 max-[600px]:gap-4">
      <div className="[&_li]:text-base [&_li]:leading-[1.9] [&_li]:text-[#546371] [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_p]:text-base [&_p]:leading-[1.9] [&_p]:text-[#546371] [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6">
        {page.sections.map((section, index) => <article key={index} id={`bolum-${index + 1}`} className={cn("mb-8 scroll-mt-6", section.title === "Kapsam ve Bilgilendirme" && box)}>
          <h2 className={cn(heading, "max-[600px]:text-lg")}>{section.title}</h2>
          {section.blocks.map(renderNode)}
        </article>)}
      </div>
      <aside className="grid gap-5 max-[850px]:grid-cols-2 max-[850px]:gap-4 max-[600px]:grid-cols-1">
        <div className={cn(card, "[&_p]:m-0 [&_p]:mb-3 [&_p]:text-base [&_p]:leading-[1.8] [&_p]:wrap-anywhere [&_span]:font-semibold")}><h2 className={heading}>Şirket Bilgileri</h2>{page.company.map(renderNode)}</div>
        <nav className={card} aria-label="Bu sayfadaki bölümler"><h2 className={heading}>Bu sayfada</h2>{page.sections.map((section, index) => <a key={index} href={`#bolum-${index + 1}`} className="mt-3 block text-[13px] leading-[1.6]">{section.title}</a>)}</nav>
        <nav className={cn(card, "max-[850px]:col-span-full")} aria-label="Kurumsal ve yasal sayfalar"><h2 className={heading}>Diğer bilgiler</h2>{legalLinks.map(link => <Link key={link.slug} href={`/${link.slug}`} aria-current={link.slug === slug ? "page" : undefined} className="mt-3 block text-[13px] leading-[1.6] aria-[current=page]:font-bold">{link.title}</Link>)}</nav>
      </aside>
    </div>
  </section>;
}
