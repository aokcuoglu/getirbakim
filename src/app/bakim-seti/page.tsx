import Link from "next/link";
import { ChevronRight, FlaskConical } from "lucide-react";
import { currentVehicle, garageVehicleLabel } from "@/modules/store/garage";
import { fitmentVehicle } from "@/modules/store/fitment-level.server";
import { maintenanceKitOptions } from "@/modules/store/maintenance-kit.server";
import { GarageButton } from "@/components/garage/garage-button";
import { KitBuilder } from "./kit-builder";

// Prototype (#172): not linked from the site and kept out of search results.
export const metadata = { title: "Bakım seti (prototip) | Getirbakim", robots: { index: false, follow: false } };

export default async function MaintenanceKitPage() {
  const vehicle = await currentVehicle();
  const typeId = (await fitmentVehicle(vehicle))?.typeId ?? null;
  const options = await maintenanceKitOptions(typeId);
  return <section className="mx-auto w-full max-w-[1280px] px-8 pt-6 pb-14 text-sm text-foreground max-[600px]:px-4 max-[600px]:pt-4">
    <nav aria-label="Sayfa yolu" className="mb-5 flex flex-wrap items-center gap-[9px] text-[13px] leading-5 text-muted-foreground">
      <Link href="/" className="underline-offset-4 hover:text-primary hover:underline">Ana sayfa</Link><ChevronRight className="size-[13px]" aria-hidden/><span aria-current="page">Bakım seti</span>
    </nav>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-amber-900"><FlaskConical className="size-3.5" aria-hidden/>PROTOTİP</span>
        <h1 className="text-[30px] leading-[38px] font-semibold tracking-[-0.6px] max-[600px]:text-[25px] max-[600px]:leading-8">{vehicle ? `${garageVehicleLabel(vehicle)} için bakım seti` : "Aracın için bakım setini oluştur"}</h1>
        <p className="mt-2 max-w-[640px] text-[13px] leading-5 text-muted-foreground">Her parça için markayı seç; set görseli seçimine göre anında güncellenir. {typeId ? "Araca bağlı ürünü olmayan parçalarda örnek ürünler gösterilir." : "Garajına araç eklediğinde parçalar aracına göre listelenir; şimdilik örnek ürünler gösteriliyor."}</p>
      </div>
      <GarageButton vehicle={vehicle} variant="catalog" className="h-12 min-h-12 w-[300px] max-[600px]:w-full"/>
    </div>
    <KitBuilder options={options}/>
  </section>;
}
