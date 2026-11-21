import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { storeButton } from "@/components/store-button";
import { aboutContact } from "@/content/about";
import { contactEmail, contactPhone } from "@/lib/site";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { loginPath } from "@/modules/auth/return-to";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { catalogPath } from "@/modules/seo/paths";
import { ORDER_LINK_DAYS, orderLinkNotices } from "@/modules/store/order-link";

export const metadata: Metadata = { title: "Sipariş bağlantısı", robots: privatePageRobots };

const eyebrow = "mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]";
const panel = "rounded-2xl border border-border bg-white p-[25px] text-sm max-[600px]:p-5";
const panelTitle = "text-[23px] leading-[34px] font-semibold";
const contactLink = "inline-flex min-h-11 items-center font-medium underline underline-offset-2 wrap-anywhere";

const copy = {
  expired: {
    title: "Bu bağlantının süresi doldu",
    lead: `E-postandaki sipariş bağlantıları güvenlik nedeniyle ${ORDER_LINK_DAYS} gün geçerlidir. Bu, siparişinde bir sorun olduğu anlamına gelmez.`,
  },
  invalid: {
    title: "Bu bağlantı açılamadı",
    lead: "Bağlantı eksik kopyalanmış ya da artık geçerli olmayabilir. E-postandaki “Siparişini görüntüle” düğmesine yeniden tıklamayı ya da bağlantının tamamını kopyalamayı dene. Yine açılmazsa aşağıdan yeni bağlantı isteyebilirsin.",
  },
} as const;

const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent("Sipariş bağlantısı")}&body=${encodeURIComponent("Sipariş numaram: \nSiparişte kullandığım e-posta: ")}`;

// Explains a signed guest link that did not open an order (#1148); the route sends only the status, never the order id or token.
export default async function OrderLinkNotice({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { durum } = normalizeSearchParams(await searchParams);
  const text = durum === orderLinkNotices.expired ? copy.expired : copy.invalid;
  return <section className="mx-auto min-h-[55vh] w-full max-w-[900px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
    <div className="mb-8 max-[600px]:mb-6">
      <p className={eyebrow}>SİPARİŞ BAĞLANTISI</p>
      <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{text.title}</h1>
      <p className="text-base leading-[1.8] text-muted-foreground">{text.lead}</p>
    </div>
    <Card className={cn(panel, "mb-6 gap-4 ring-0")}>
      <h2 className={panelTitle}>Ne yapabilirsin?</h2>
      <div className="grid gap-4 text-[13px] leading-[1.7]">
        <div>
          <h3 className="font-semibold">Yeni bağlantı iste</h3>
          <p>Sipariş numaranı ve siparişte kullandığın e-posta adresini bize yaz; onay e-postanı yeni bir bağlantıyla yeniden gönderelim.</p>
          <p className="text-muted-foreground">{contactEmail} · {aboutContact.phone}</p>
        </div>
        <div>
          <h3 className="font-semibold">Siparişi verdiğin tarayıcıyı kullan</h3>
          <p>Siparişi verdiğin telefon ya da bilgisayardaki tarayıcıda sipariş sayfan genellikle bağlantı olmadan da açılır; açılmazsa yeni bağlantı iste.</p>
        </div>
        <div>
          <h3 className="font-semibold">Servis hesabınla sipariş verdiysen</h3>
          <p>Giriş yaparak siparişlerini görebilirsin. <Link href={loginPath("/siparisler")} className={contactLink}>Giriş yap</Link></p>
        </div>
      </div>
    </Card>
    <div className="flex flex-wrap items-center gap-3 max-[600px]:flex-col max-[600px]:items-stretch">
      <Button nativeButton={false} className={cn(storeButton({ intent: "primary", size: "lg" }), "max-[600px]:w-full")} render={<a href={mailto}/>}>E-posta gönder</Button>
      <Button nativeButton={false} className={cn(storeButton({ intent: "outline", size: "lg" }), "max-[600px]:w-full")} render={<a href={`tel:${contactPhone}`}/>}>Bizi ara</Button>
      <Button nativeButton={false} className={cn(storeButton({ intent: "link", size: "lg" }), "max-[600px]:w-full")} render={<Link href={catalogPath}/>}>Alışverişe devam et</Button>
    </div>
  </section>;
}
