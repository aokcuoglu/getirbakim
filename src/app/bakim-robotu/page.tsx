import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Wrench, Layers, Images, ShoppingCart, CarFront } from "lucide-react";
import { currentVehicle, garageVehicleLabel } from "@/modules/store/garage";
import { fitmentVehicle } from "@/modules/store/fitment-level.server";
import { maintenanceKitOptions } from "@/modules/store/maintenance-kit.server";
import { GarageButton } from "@/components/garage/garage-button";
import { KitBuilder } from "./kit-builder";

export const metadata: Metadata = {
  title: "Bakım Robotu | Getirbakim",
  description: "Garajındaki araç için 3'lü, 4'lü veya 5'li filtre ve motor yağı bakım setini markalarını seçerek kur; set görselini ve toplam fiyatı anında gör, tek tıkla sepete ekle.",
  alternates: { canonical: "/bakim-robotu" },
};

const steps = [
  { icon: CarFront, title: "Aracını seç", text: "Garajındaki aracın motor tipine bağlı ürünler listelenir." },
  { icon: Layers, title: "Paketini kur", text: "3'lü, 4'lü veya 5'li paketten başla; yuvaları ekle ya da çıkar." },
  { icon: Images, title: "Markaları seç", text: "Her yuvada markayı seç; set görselin anında yeniden oluşur." },
  { icon: ShoppingCart, title: "Sepete ekle", text: "Setin tüm parçaları araç bilginle birlikte sepete girer." },
];

export default async function MaintenanceRobot() {
  const vehicle = await currentVehicle();
  const resolved = await fitmentVehicle(vehicle);
  const typeId = resolved?.typeId ?? null;
  const options = typeId ? await maintenanceKitOptions(typeId) : null;
  const vehicleName = vehicle ? garageVehicleLabel(vehicle) : null;
  return <div className="bg-white text-sm leading-5 text-foreground">
    <section className="relative bg-[#212b36] bg-[url('/media/site/images/mobile-catalog.webp')] bg-cover bg-center bg-no-repeat pb-10 text-white max-[600px]:pb-6">
      <div className="flex h-[52px] items-center justify-center gap-2 bg-[#212b3633] text-sm text-white/85 max-[600px]:text-xs"><Wrench size={18} aria-hidden="true"/><span>Aracına özel filtre ve motor yağı bakım seti</span></div>
      <div className="mx-auto w-full max-w-[1384px] px-8 max-[600px]:px-[15px]">
        <h1 className="mt-6 mb-2 text-center text-[34px] leading-[42px] font-semibold tracking-[-.7px] max-[600px]:text-[28px] max-[600px]:leading-9">Bakım Robotu</h1>
        <p className="mx-auto mb-6 max-w-[640px] text-center text-[15px] leading-6 text-white/85">Paketini seç, her yuvada markayı belirle; set görselin ve toplam fiyatın anında hazırlanır.</p>
        <div className="flex justify-center [&>button]:h-14 [&>button]:min-h-14 [&>button]:w-[360px] max-[600px]:[&>button]:w-full"><GarageButton vehicle={vehicle} variant="catalog"/></div>
      </div>
    </section>
    <section className="mx-auto w-[calc(100%-30px)] max-w-[1320px] pb-[50px]">
      <nav aria-label="Sayfa yolu" className="flex min-h-[45px] flex-wrap items-center gap-[5px] pt-2 pb-4 text-[13px] leading-[21px] text-[#54626e] max-[600px]:text-xs">
        <Link href="/" className="hover:text-primary hover:underline underline-offset-4">Ana sayfa</Link><ChevronRight size={10} aria-hidden="true"/><span aria-current="page">Bakım Robotu</span>
      </nav>
      {options && vehicleName ? <KitBuilder slots={options.slots} vehicleName={vehicleName} oilCapacityLabel={options.oilCapacityLabel} oilViscosities={options.oilSpec?.viscosities ?? []}/>
        : <div className="mx-auto my-6 max-w-[720px] rounded-xl border border-border bg-[#f7f8fa] px-6 py-10 text-center">
          <CarFront size={44} strokeWidth={1.4} className="mx-auto mb-4 text-muted-foreground" aria-hidden="true"/>
          <h2 className="mb-2 text-[22px] leading-[30px] font-semibold">{vehicle ? "Aracını katalogdan seç" : "Önce aracını seç"}</h2>
          <p className="mx-auto mb-6 max-w-[520px] text-sm leading-[22px] text-muted-foreground">{vehicle
            ? `“${vehicleName}” serbest metinle kaydedilmiş. Bakım seti için aracını marka, model ve motor tipiyle katalogdan seçmen gerekiyor.`
            : "Bakım seti aracın motor tipine göre kurulur. Garajından marka, model ve motor tipini seçerek başla."}</p>
          <div className="flex justify-center [&>button]:h-12 [&>button]:min-h-12 [&>button]:w-[320px] [&>button]:border-border [&>button]:text-foreground max-[600px]:[&>button]:w-full"><GarageButton vehicle={vehicle} variant="catalog"/></div>
        </div>}
    </section>
    <section className="border-t border-border bg-[#f8f9f9] py-12"><div className="mx-auto grid max-w-[1350px] grid-cols-4 gap-8 px-[15px] max-[900px]:grid-cols-2 max-[600px]:grid-cols-1 max-[600px]:gap-6">
      {steps.map(({ icon: Icon, title, text }, index) => <div key={title} className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-primary ring-1 ring-border"><Icon size={20} strokeWidth={1.6} aria-hidden="true"/></span><span><strong className="block text-base leading-6 font-medium">{index + 1}. {title}</strong><p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{text}</p></span></div>)}
    </div></section>
  </div>;
}
