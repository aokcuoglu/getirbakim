import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalBlocks, legalBodyClass, legalCardClass, legalHeadingClass } from "@/components/legal-page";
import { currentOrderAgreement } from "@/modules/store/order-read";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sipariş sözleşmeleri", robots: { index: false, follow: false } };

const time = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

// The copy stored when the order was placed; never rebuilt from the current legal pages.
export default async function OrderAgreement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await currentOrderAgreement(id);
  if (!result) notFound();
  const { order, agreement } = result;
  return <section className="mx-auto min-h-[55vh] w-full max-w-[900px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10 [&_a:not([data-back])]:text-primary [&_a:not([data-back])]:underline [&_a:not([data-back])]:underline-offset-3 [&_a:not([data-back])]:wrap-anywhere">
    <Link data-back href={`/siparis/${order.id}`} className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary">← Siparişe dön</Link>
    <div className="mb-8 max-[600px]:mb-6">
      <p className="mb-2 block text-base leading-[1.8] font-medium tracking-[1.2px] text-muted-foreground">SÖZLEŞME KOPYASI</p>
      <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Sipariş #{order.number} sözleşmeleri</h1>
      <p className="text-base leading-[1.8] text-muted-foreground">Bu metinler siparişin oluşturulduğu anda bu sipariş için hazırlandı ve değişmeden saklanır.</p>
      <div className="mt-4 grid gap-1 text-xs leading-[1.8] text-muted-foreground">
        <p>Onay zamanı: <time dateTime={new Date(agreement.accepted_at).toISOString()}>{time(agreement.accepted_at)}</time> · Metin sürümü: {agreement.legal_version}</p>
        <p>Onaylanan beyan: {agreement.consent_text}</p>
      </div>
    </div>
    <div className="grid gap-8 max-[600px]:gap-5">
      {agreement.document.documents.map(document => <article key={document.slug} className={cn(legalCardClass, legalBodyClass)}>
        <h2 className="mb-5 text-[23px] leading-[34px] font-semibold wrap-anywhere">{document.title}</h2>
        {document.sections.map((section, index) => <div key={index} className="mb-6 last:mb-0">
          <h3 className={cn(legalHeadingClass, "max-[600px]:text-lg")}>{section.title}</h3>
          <LegalBlocks blocks={section.blocks}/>
        </div>)}
      </article>)}
    </div>
  </section>;
}
