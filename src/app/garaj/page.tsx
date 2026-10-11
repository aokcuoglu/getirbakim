import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import { CarFront,ChevronRight,Check,Trash2 } from "lucide-react";
import { currentVehicle,savedVehicles,vehicleKey,garageVehicleLabel } from "@/modules/store/garage";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveVehicle,removeVehicle,switchVehicleForm,removeVehicleForm } from "./actions";
const vehicleMakes=["Volkswagen","BMW","Mercedes-Benz","Audi","Renault","Ford","Peugeot","Toyota","Fiat","Opel","Hyundai","Honda"];
const label="text-sm leading-5 font-normal";
const input="h-[52px] rounded-lg bg-white px-3.5 py-[13px] text-base leading-6 md:text-base placeholder:text-sm";

export default async function Garage({searchParams}:{searchParams:Promise<SearchParams>}) {
 const [vehicle,saved,params]=await Promise.all([currentVehicle(),savedVehicles(),searchParams.then(normalizeSearchParams)]);
 const others=saved.vehicles.filter(entry=>!vehicle||entry.key!==vehicleKey(vehicle));
 return <section className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
  <nav aria-label="Sayfa yolu" className="mb-7 flex flex-wrap items-center gap-[9px] text-[13px] leading-5 wrap-anywhere text-muted-foreground"><Link href="/" className="inline-flex min-h-8 items-center underline-offset-4 hover:text-primary hover:underline">Ana sayfa</Link><ChevronRight className="size-[13px]" aria-hidden/><span aria-current="page">Garajım</span></nav>
  <div className="mx-auto grid max-w-[1020px] grid-cols-[1fr_440px] gap-[70px] max-[1000px]:grid-cols-2 max-[1000px]:gap-[35px] max-[600px]:grid-cols-1 max-[600px]:gap-6">
   <div>
    <span className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">GETİRBAKİM GARAJIM</span>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Aracını tanıyalım.</h1>
    <p className="text-base leading-6 text-muted-foreground">Marka, model ve yıl bilgilerini kaydet.<br/>Aracın, sonraki ziyaretinde de garajında olsun.</p>
    <CarFront className="my-5 h-[150px] w-[190px] text-[#8ea9bf] max-[600px]:hidden" strokeWidth={1} aria-hidden/>
    <p className="max-w-[440px] text-[11px] leading-[22px] text-muted-foreground">{saved.signedIn ? "Araçların hesabına kaydedilir ve her cihazda görünür." : "Araçların bu tarayıcıda 30 gün saklanır (en çok 5). B2B hesabınla giriş yaparsan hesabına kaydedilir."} Katalogda “Yalnızca aracıma uyanları göster” ile araç tipine bağlı ürünleri süzebilirsin; bağlantısı olmayan ürünlerde OEM numarasını kontrol et.</p>
   </div>
   <Card className="gap-0 rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5">
    {params.saved && <Alert role="status" className="mb-4 flex items-center gap-2 rounded-md border-0 bg-[#ebf5ed] p-[13px] text-sm leading-5 text-[#397247]"><Check className="size-[18px] shrink-0" aria-hidden/> Araç bilgilerin kaydedildi.</Alert>}
    {params.error && <Alert className="mb-4 rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]">Marka, model ve yılı kontrol et.</Alert>}
    <h2 className="text-[23px] leading-[34px] font-semibold">{vehicle ? "Araç bilgilerini güncelle" : "Garajına araç ekle"}</h2>
    <form action={saveVehicle} className="grid gap-5">
     <Field className="gap-2"><FieldLabel htmlFor="garage-make" className={label}>Marka</FieldLabel><Input id="garage-make" className={input} name="make" defaultValue={params.make?.slice(0,40) ?? vehicle?.make ?? ""} placeholder="Örn. Volkswagen" minLength={2} maxLength={40} required list="vehicle-makes"/></Field>
     <datalist id="vehicle-makes">{vehicleMakes.map(m=><option key={m} value={m}/>)}</datalist>
     <Field className="gap-2"><FieldLabel htmlFor="garage-model" className={label}>Model</FieldLabel><Input id="garage-model" className={input} name="model" defaultValue={vehicle?.model} placeholder="Örn. Golf 1.6 TDI" maxLength={60} required/></Field>
     <Field className="gap-2"><FieldLabel htmlFor="garage-year" className={label}>Model yılı</FieldLabel><Input id="garage-year" className={input} name="year" type="number" min={1950} max={new Date().getFullYear()+1} defaultValue={vehicle?.year} placeholder="Örn. 2018" required/></Field>
     <Button type="submit" className="h-auto min-h-12 w-full gap-2.5 rounded-lg px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong">Aracımı kaydet <ChevronRight className="size-4" aria-hidden/></Button>
    </form>
    {vehicle && <form action={removeVehicle}><Button type="submit" variant="link" className="mt-3 h-auto min-h-0 border-0 bg-transparent px-0 py-[5px] text-sm leading-5 font-normal text-primary hover:bg-transparent hover:text-brand-strong hover:no-underline">Aracı garajımdan kaldır</Button></form>}
    {others.length>0 && <><h2 className="mt-6 mb-2 text-lg leading-7 font-semibold">Diğer kayıtlı araçlar</h2><ul className="grid divide-y divide-border">{others.map(entry=><li key={entry.key} className="flex items-center gap-3 py-2.5 text-sm leading-5"><span className="min-w-0 flex-1 wrap-anywhere">{garageVehicleLabel(entry)}</span>
     <form action={switchVehicleForm}><input type="hidden" name="key" value={entry.key}/><Button type="submit" variant="link" className="h-auto min-h-0 px-0 text-sm font-normal text-primary">Bu aracı seç</Button></form>
     <form action={removeVehicleForm}><input type="hidden" name="key" value={entry.key}/><Button type="submit" variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`${entry.make} ${entry.model} aracını kaldır`}><Trash2 className="size-[15px]"/></Button></form></li>)}</ul></>}
   </Card>
  </div>
 </section>;
}
