import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { guidePath, guides, guidesPath } from "@/content/guides";
import { pageMetadata, siteUrl } from "@/lib/site";
import { breadcrumbJsonLd, collectionJsonLd, guideTrail } from "@/modules/seo/structured-data";

const description = "Yedek parça seçimi ve araç bakımıyla ilgili sık sorulan konuları kısa yanıtlarla anlatan Getirbakim rehber yazıları.";

export const metadata = pageMetadata({ title: "Yedek parça ve bakım rehberi", description, path: guidesPath });

export default function Guides() {
  const date = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" });
  return <section className="mx-auto min-h-[55vh] w-full max-w-[830px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
    <JsonLd data={breadcrumbJsonLd(guideTrail(), siteUrl)}/>
    <JsonLd data={collectionJsonLd({ name: "Rehber", description, path: guidesPath, items: guides.map(guide => ({ path: guidePath(guide.slug), name: guide.title })) }, siteUrl)}/>
    <Link className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary" href="/">← Ana sayfa</Link>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] max-[600px]:text-[27px] max-[600px]:leading-[35px]">Rehber</h1>
    <p className="mb-8 text-[15px] leading-[1.9] text-muted-foreground">Doğru parçayı seçmek ve aracının bakımını planlamak için kısa, doğrudan yanıtlar. Her yazı kaynaklarını ve güncelleme tarihini gösterir.</p>
    <ul className="grid list-none gap-4">{guides.map(guide => <li key={guide.slug}>
      <Link href={guidePath(guide.slug)} className="block rounded-xl border border-border p-5 hover:border-primary max-[600px]:p-4">
        <h2 className="mb-2 text-lg leading-6 font-semibold">{guide.title}</h2>
        <p className="mb-3 text-sm leading-[1.8] text-muted-foreground">{guide.description}</p>
        <p className="text-xs leading-5 text-muted-foreground">Güncelleme: <time dateTime={guide.updated}>{date.format(new Date(guide.updated))}</time></p>
      </Link>
    </li>)}</ul>
  </section>;
}
