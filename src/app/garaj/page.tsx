import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import { CarFront,ChevronRight,Check } from "lucide-react";
import { currentVehicle } from "@/modules/store/garage";
import { saveVehicle,removeVehicle } from "./actions";
const vehicleMakes=["Volkswagen","BMW","Mercedes-Benz","Audi","Renault","Ford","Peugeot","Toyota","Fiat","Opel","Hyundai","Honda"];

export default async function Garage({searchParams}:{searchParams:Promise<SearchParams>}) {
 const [vehicle,params]=await Promise.all([currentVehicle(),searchParams.then(normalizeSearchParams)]);
 return <section className="shell page-section">
  <div className="breadcrumbs"><Link href="/">Ana sayfa</Link><ChevronRight size={13}/><span>Garajım</span></div>
  <div className="garage-layout">
   <div>
    <span className="eyebrow">GETİRBAKİM GARAJIM</span>
    <h1 className="page-title">Aracını tanıyalım.</h1>
    <p className="lead">Marka, model ve yıl bilgilerini kaydet.<br/>Aracın, sonraki ziyaretinde de garajında olsun.</p>
    <CarFront className="garage-illustration" strokeWidth={1}/>
    <p className="muted">Araç kaydı bu tarayıcıda 30 gün saklanır. Katalogda araç uyumluluğu filtrelemesi henüz açık değildir; kayıtlı bir araç ürünün uyumlu olduğunu göstermez.</p>
   </div>
   <div className="panel">
    {params.saved && <p role="status" className="success"><Check size={18}/> Araç bilgilerin kaydedildi.</p>}
    {params.error && <p role="alert" className="error">Marka, model ve yılı kontrol et.</p>}
    <h2>{vehicle ? "Araç bilgilerini güncelle" : "Garajına araç ekle"}</h2>
    <form action={saveVehicle} className="stack">
     <label>Marka<input name="make" defaultValue={params.make?.slice(0,40) ?? vehicle?.make ?? ""} placeholder="Örn. Volkswagen" minLength={2} maxLength={40} required list="vehicle-makes"/></label>
     <datalist id="vehicle-makes">{vehicleMakes.map(m=><option key={m} value={m}/>)}</datalist>
     <label>Model<input name="model" defaultValue={vehicle?.model} placeholder="Örn. Golf 1.6 TDI" maxLength={60} required/></label>
     <label>Model yılı<input name="year" type="number" min={1950} max={new Date().getFullYear()+1} defaultValue={vehicle?.year} placeholder="Örn. 2018" required/></label>
     <button>Aracımı kaydet <ChevronRight size={16}/></button>
    </form>
    {vehicle && <form action={removeVehicle}><button className="text-button">Aracı garajımdan kaldır</button></form>}
   </div>
  </div>
 </section>;
}
