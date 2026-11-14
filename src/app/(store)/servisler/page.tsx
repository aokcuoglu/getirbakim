import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { contactEmail } from "@/lib/site";
import { cn } from "@/lib/utils";
export const metadata: Metadata = {
  title: "Servisler için Getirbakim | Güvenilir parça tedariki",
  description: "Oto servisin için Getirbakim’e başvur. Onaylı hesabında servisine özel fiyatları gör, ürün ve OEM koduyla parça ara.",
  alternates: { canonical: "/servisler" },
};
const panel="gap-0 rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5";
const panelTitle="text-[23px] leading-[34px] font-semibold";
const panelText="text-[13px] leading-[1.8]";
const cta="h-auto min-h-12 gap-2.5 rounded-lg px-[27px] py-[13px] text-sm leading-5 font-medium max-[600px]:w-full";

export default function Services() {
  return <section className="mx-auto min-h-[55vh] w-full max-w-[1050px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
    <p className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">SERVİSLER İÇİN GETİRBAKİM</p>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Servisinin parça ihtiyacı için güvenilir tedarik.</h1>
    <p className="max-w-[730px] text-base leading-6 text-muted-foreground">Parçadan anlayan bir ekiple çalış. Kendi stokumuz ve tedarik ağımız üzerinden parçaları incele, onaylı servis hesabınla sana özel fiyatlara ulaş.</p>
    <div className="my-6 flex flex-wrap gap-4"><Button nativeButton={false} className={cn(cta,"border-primary hover:bg-brand-strong")} render={<Link href="/servisler/basvuru"/>}>Servis hesabına başvur</Button><Button variant="outline" nativeButton={false} className={cn(cta,"border-input bg-white text-foreground hover:border-[#54626e] hover:bg-[#f9fafb]")} render={<Link href="/giris"/>}>B2B hesabıma giriş yap</Button></div>
    <div className="mt-6 grid grid-cols-1 gap-5 *:min-w-0">
      <Card className={cn(panel,"mt-6")}><h2 className={panelTitle}>Servisine özel fiyatlar</h2><p className={panelText}>Bireysel fiyatlar herkese açık. Servisine tanımlanan indirim, hesabın onaylandıktan sonra katalogda ve sepette uygulanır.</p></Card>
      <Card className={cn(panel,"mt-6")}><h2 className={panelTitle}>Kodla kolay parça arama</h2><p className={panelText}>Ürün ve OEM koduyla ara; üretici, motor ve araç özelliklerini karşılaştır. Uyumluluk konusunda destek almak için ekibimize ulaş.</p></Card>
    </div>
    <Card className={cn(panel,"mt-6")}>
      <h2 className={panelTitle}>Nasıl başlarım?</h2>
      <ol className="list-decimal pl-6 leading-[2]"><li>Servis ve iletişim bilgilerinle başvurunu gönder.</li><li>Ekibimiz servis bilgilerini kontrol edip seninle iletişime geçsin.</li><li>Onaydan sonra belirlediğin şifreyle giriş yap ve fiyatlarını gör.</li></ol>
      <p className={panelText}>Başvuru ücretsizdir. Onay otomatik verilmez; ticari koşullar servis bazında değerlendirilir.</p>
    </Card>
    <Card className={cn(panel,"mt-6")}><h2 className={panelTitle}>Acil parça ihtiyacın mı var?</h2><p className={panelText}>Servisin için ek ücretli moto-kurye teslimatını destek ekibimize sor. Uygun stok, adres ve hizmet saatleri kontrol edilir; kurye ücreti ve teslimat zamanı gönderim öncesinde birlikte netleştirilir.</p><a className="mt-5 flex w-fit items-center gap-1.5 text-sm leading-5 text-primary hover:underline" href="tel:+902163870078">Moto-kurye için destek al: 0216 387 00 78</a></Card>
    <Alert role="note" className="rounded-md border-0 bg-[#eaf1f7] p-[15px] text-sm leading-5 text-[#50718e]">Katalog, sepet ve sipariş kullanıma açık. Siparişler stok ve sevkiyat teyidiyle işleme alınır.</Alert>
    <p>Destek: <a href="tel:+902163870078" className="hover:text-primary">0216 387 00 78</a> · <a href={`mailto:${contactEmail}`} className="hover:text-primary">{contactEmail}</a></p>
  </section>;
}
