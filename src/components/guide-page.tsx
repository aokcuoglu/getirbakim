import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { guideCategoryLabels, guidesPath, type Guide } from "@/content/guides";
import { guideBodies } from "@/content/guides/bodies";
import { categoryPath, catalogPath } from "@/modules/seo/paths";

const prose = "text-[15px] leading-[1.9] text-[#546371] [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-3 [&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:text-[22px] [&_h2]:leading-8 [&_h2]:font-semibold [&_h2]:tracking-[-.4px] [&_h2]:text-foreground [&_li]:mb-1.5 [&_p]:mb-4 [&_table]:w-full [&_table]:min-w-[28rem] [&_table]:border-collapse [&_table]:text-left [&_table]:text-sm [&_td]:border [&_td]:border-border [&_td]:p-3 [&_th]:border [&_th]:border-border [&_th]:bg-[#f7f8fa] [&_th]:p-3 [&_th]:font-semibold [&_th]:text-foreground [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6";

/** One guide article: breadcrumb, H1, short answer, dates, body, sources, related categories and links. */
export function GuidePage({ guide }: { guide: Guide }) {
  const Body = guideBodies[guide.slug];
  const date = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" });
  const h2 = "mt-9 mb-3 text-[22px] leading-8 font-semibold tracking-[-.4px]";
  return <article className="mx-auto min-h-[55vh] w-full max-w-[830px] px-8 pt-6 pb-14 max-[600px]:px-5 max-[600px]:pb-10">
    <Breadcrumb aria-label="Sayfa yolu" className="mb-6"><BreadcrumbList className="gap-[9px] text-[13px] leading-5">
      <BreadcrumbItem><BreadcrumbLink render={<Link href="/"/>} className="inline-flex min-h-8 items-center hover:text-brand hover:underline">Ana sayfa</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="[&>svg]:size-[13px]"/>
      <BreadcrumbItem><BreadcrumbLink render={<Link href={guidesPath}/>} className="inline-flex min-h-8 items-center hover:text-brand hover:underline">Rehber</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="[&>svg]:size-[13px]"/>
      <BreadcrumbItem><BreadcrumbPage className="text-muted-foreground">{guide.title}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList></Breadcrumb>
    <h1 className="mb-4 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{guide.title}</h1>
    <p className="mb-6 text-xs leading-5 text-muted-foreground">
      Yayın: <time dateTime={guide.published}>{date.format(new Date(guide.published))}</time> · Güncelleme: <time dateTime={guide.updated}>{date.format(new Date(guide.updated))}</time><br/>
      {guide.reviewedBy ? `Gözden geçiren: ${guide.reviewedBy.name}, ${guide.reviewedBy.role}` : "Hazırlayan: Getirbakim ekibi"}
    </p>
    <section aria-labelledby="kisa-yanit" className="mb-8 rounded-lg border border-border bg-[#eef7fd] p-5 max-[600px]:p-4">
      <h2 id="kisa-yanit" className="mb-2 text-base leading-6 font-semibold">Kısa yanıt</h2>
      <p className="text-[15px] leading-[1.8]">{guide.answer}</p>
    </section>
    <div className={prose}><Body/></div>
    <section aria-labelledby="kaynaklar"><h2 id="kaynaklar" className={h2}>Kaynaklar</h2>
      <ul className="list-disc pl-6 text-[15px] leading-[1.9] text-[#546371]">{guide.sources.map(source => <li key={source.title}>{source.url ? <Link className="text-primary underline underline-offset-3" href={source.url}>{source.title}</Link> : source.title}</li>)}</ul>
    </section>
    <section aria-labelledby="ilgili-kategoriler"><h2 id="ilgili-kategoriler" className={h2}>İlgili kategoriler</h2>
      <ul className="flex flex-wrap gap-2">{guide.categories.map(slug => <li key={slug}><Link className="inline-flex min-h-9 items-center rounded-lg border border-border px-4 text-sm hover:border-primary hover:text-primary" href={categoryPath(slug)}>{guideCategoryLabels[slug]}</Link></li>)}</ul>
    </section>
    {guide.related?.length ? <section aria-labelledby="ilgili-yazilar"><h2 id="ilgili-yazilar" className={h2}>İlgili sayfalar</h2>
      <ul className="list-disc pl-6 text-[15px] leading-[1.9]">{guide.related.map(link => <li key={link.path}><Link className="text-primary underline underline-offset-3" href={link.path}>{link.title}</Link></li>)}</ul>
    </section> : null}
    <Button nativeButton={false} className="mt-10 h-auto min-h-12 gap-2.5 rounded-lg border-primary px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong" render={<Link href={catalogPath}/>}>Kataloğa göz at →</Button>
  </article>;
}

