import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check, ChevronRight, Wrench, Layers, Images, ShoppingCart, CarFront } from "lucide-react";
import { currentVehicle, garageVehicleLabel } from "@/modules/store/garage";
import { fitmentVehicle } from "@/modules/store/fitment-level.server";
import { maintenanceKitOptions } from "@/modules/store/maintenance-kit.server";
import { kitCountLabel, kitKindLabel, kitPackages } from "@/modules/store/maintenance-kit";
import { GarageButton } from "@/components/garage/garage-button";
import { KitBuilder } from "./kit-builder";

export const metadata: Metadata = {
  title: "Bakım Robotu | Getirbakim",
  description: "Garajındaki araç için 3'lü, 4'lü veya 5'li filtre ve motor yağı bakım setini markalarını seçerek kur; set görselini ve toplam fiyatı anında gör, tek tıkla sepete ekle.",
  alternates: { canonical: "/bakim-robotu" },
};

const steps = [
  { icon: CarFront, title: "Aracını seç", text: "Motor tipine uyan ürünler listelenir." },
  { icon: Layers, title: "Paketini kur", text: "3'lü, 4'lü veya 5'li paketten başla." },
  { icon: Images, title: "Markaları seç", text: "Set görselin anında yeniden oluşur." },
  { icon: ShoppingCart, title: "Sepete ekle", text: "Tüm parçalar araç bilginle sepete girer." },
];
const perks = ["Yalnız aracına uyan filtre ve yağlar", "Her parçada markayı sen seçersin", "Set görseli ve toplam fiyat anında"];

export default async function MaintenanceRobot() {
  const vehicle = await currentVehicle();
  const resolved = await fitmentVehicle(vehicle);
  const typeId = resolved?.typeId ?? null;
  const options = typeId ? await maintenanceKitOptions(typeId) : null;
  const vehicleName = vehicle ? garageVehicleLabel(vehicle) : null;
  return <div className="bg-white text-sm leading-5 text-foreground">
    <section className="relative overflow-hidden bg-[linear-gradient(118deg,#0a2540_0%,#0b4a85_58%,#0077c7_100%)] text-white">
      <span aria-hidden="true" className="pointer-events-none absolute -top-40 -right-24 size-[520px] rounded-full bg-white/[.06]"/>
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-48 left-[30%] size-[380px] rounded-full bg-[#4fb3ff]/[.1]"/>
      <div className="relative mx-auto grid w-full max-w-[1384px] grid-cols-[minmax(0,1fr)_400px] items-center gap-12 px-8 pt-12 pb-14 max-[1000px]:grid-cols-[minmax(0,1fr)_280px] max-[1000px]:gap-8 max-[760px]:grid-cols-1 max-[600px]:px-[15px] max-[600px]:pt-8 max-[600px]:pb-9">
        <div className="min-w-0">
          <p className="mb-4 flex items-center gap-2">
            <span className="rounded-[2px] bg-[#c94037] px-2 py-1 text-[11px] leading-4 font-bold tracking-[.6px]">YENİ</span>
            <span className="inline-flex items-center gap-1.5 text-[13px] leading-5 font-semibold tracking-[.8px] text-[#9fd3ff]"><Wrench size={15} aria-hidden="true"/>BAKIM ROBOTU</span>
          </p>
          <h1 className="mb-3 max-w-[620px] text-balance text-[40px] leading-[48px] font-semibold tracking-[-1px] max-[1000px]:text-[34px] max-[1000px]:leading-[42px] max-[600px]:text-[28px] max-[600px]:leading-9">Aracının bakım setini dakikalar içinde kur</h1>
          <p className="mb-5 max-w-[560px] text-[15px] leading-6 text-white/85">Paketini seç, her yuvada markayı belirle; set görselin ve toplam fiyatın anında hazırlanır.</p>
          <ul className="mb-7 grid gap-2 text-sm leading-5 text-white/90 max-[600px]:mb-6">
            {perks.map(perk => <li key={perk} className="flex items-center gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#7cd992]/20"><Check size={13} strokeWidth={2.5} className="text-[#7cd992]" aria-hidden="true"/></span>{perk}</li>)}
          </ul>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 [&>button]:h-14 [&>button]:min-h-14 [&>button]:w-[360px] max-[600px]:[&>button]:w-full">
            <GarageButton vehicle={vehicle} variant="catalog"/>
            <span className="text-[13px] leading-5 text-white/70">{options && vehicleName ? "Setin aşağıda hazır; aracını buradan değiştirebilirsin." : "Başlamak için aracını seç."}</span>
          </div>
        </div>
        <div className="relative max-[760px]:hidden">
          <div className="rotate-[2.5deg] overflow-hidden rounded-xl bg-white p-2 shadow-[0_24px_60px_#0a254080]">
            <Image src="/media/site/images/bakim-robotu-set.webp" width={720} height={666} alt="Örnek 3'lü filtre seti: hava, yağ ve polen filtresi" priority unoptimized className="h-auto w-full rounded-lg"/>
          </div>
          <p className="absolute -bottom-4 -left-6 flex items-center gap-2 rounded-lg bg-white px-3.5 py-2.5 text-[13px] leading-5 font-semibold text-foreground shadow-[0_10px_30px_#0a254040] max-[1000px]:-left-3">
            <Images size={17} className="text-primary" aria-hidden="true"/>Set görselin seçimine göre oluşur</p>
        </div>
      </div>
    </section>
    <section aria-label="Nasıl çalışır" className="border-b border-border bg-[#f8f9f9]">
      <ol className="mx-auto grid max-w-[1384px] grid-cols-4 px-8 max-[900px]:grid-cols-2 max-[600px]:px-[15px]">
        {steps.map(({ icon: Icon, title, text }, index) => <li key={title} className="flex items-center gap-3 border-border py-5 pr-4 not-first:border-l not-first:pl-6 max-[900px]:nth-3:border-l-0 max-[900px]:nth-3:pl-0 max-[900px]:nth-[n+3]:border-t max-[600px]:gap-2.5 max-[600px]:py-3.5 max-[600px]:pr-2 max-[600px]:not-first:pl-3 max-[600px]:nth-3:pl-0">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-white text-primary ring-1 ring-border max-[600px]:size-9"><Icon size={20} strokeWidth={1.6} aria-hidden="true"/>
            <span className="absolute -top-1 -right-1 grid size-[18px] place-items-center rounded-full bg-primary text-[11px] leading-none font-semibold text-white">{index + 1}</span></span>
          <span className="min-w-0"><strong className="block text-[15px] leading-5 font-semibold max-[600px]:text-[13px]">{title}</strong><span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground max-[600px]:hidden">{text}</span></span>
        </li>)}
      </ol>
    </section>
    <section className="mx-auto w-[calc(100%-30px)] max-w-[1320px] pb-[60px]">
      <nav aria-label="Sayfa yolu" className="flex min-h-[45px] flex-wrap items-center gap-[5px] pt-2 pb-4 text-[13px] leading-[21px] text-[#54626e] max-[600px]:text-xs">
        <Link href="/" className="hover:text-primary hover:underline underline-offset-4">Ana sayfa</Link><ChevronRight size={10} aria-hidden="true"/><span aria-current="page">Bakım Robotu</span>
      </nav>
      {options && vehicleName ? <KitBuilder slots={options.slots} vehicleName={vehicleName} oilCapacityLabel={options.oilCapacityLabel} oilViscosities={options.oilSpec?.viscosities ?? []}/>
        : <div className="mx-auto my-4 grid max-w-[1000px] grid-cols-2 overflow-hidden rounded-xl border border-border bg-white max-[760px]:grid-cols-1">
          <div className="flex flex-col justify-center px-10 py-10 max-[600px]:px-5 max-[600px]:py-7">
            <span className="mb-4 grid size-12 place-items-center rounded-full bg-[#eef7fd] text-primary"><CarFront size={26} strokeWidth={1.6} aria-hidden="true"/></span>
            <h2 className="mb-2 text-[24px] leading-[31px] font-semibold tracking-[-.5px]">{vehicle ? "Aracını katalogdan seç" : "Önce aracını seç"}</h2>
            <p className="mb-6 text-sm leading-[22px] text-muted-foreground">{vehicle
              ? `“${vehicleName}” serbest metinle kaydedilmiş. Bakım seti için aracını marka, model ve motor tipiyle katalogdan seçmen gerekiyor.`
              : "Bakım seti aracın motor tipine göre kurulur. Garajından marka, model ve motor tipini seçerek başla."}</p>
            <div className="[&>button]:h-12 [&>button]:min-h-12 [&>button]:w-full [&>button]:max-w-[340px] [&>button]:border-border [&>button]:text-foreground"><GarageButton vehicle={vehicle} variant="catalog"/></div>
          </div>
          <div className="border-l border-border bg-[#f7f8fa] px-8 py-8 max-[760px]:border-t max-[760px]:border-l-0 max-[600px]:px-5 max-[600px]:py-6">
            <p className="mb-4 text-xs leading-4 font-semibold tracking-[.6px] text-muted-foreground uppercase">Hazır paketler</p>
            <ul className="grid gap-2.5">
              {kitPackages.map(pack => <li key={pack.size} className="flex items-center gap-3.5 rounded-lg border border-border bg-white px-4 py-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary text-[15px] leading-none font-bold text-white">{kitCountLabel(pack.size, true)}</span>
                <span className="min-w-0"><strong className="block text-[15px] leading-5 font-semibold">{kitCountLabel(pack.size)} {kitKindLabel(pack.slots)}</strong><span className="block text-[13px] leading-[18px] text-muted-foreground">{pack.description}</span></span>
              </li>)}
            </ul>
            <p className="mt-4 text-xs leading-[18px] text-muted-foreground">Paketi seçtikten sonra yuvaları tek tek ekleyip çıkarabilirsin; hidrolik filtre de seçilebilir.</p>
          </div>
        </div>}
    </section>
  </div>;
}
