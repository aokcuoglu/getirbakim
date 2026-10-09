import { SiteIcon } from "@/components/ui/site-icon";

export function ServiceStrip() {
  return <section className="service-strip"><div className="shell">
    <div><SiteIcon name="lens" size={24}/><span><b>Kolay parça arama</b><small>Ürün adı, kodu veya OEM numarasıyla</small></span></div>
    <div><SiteIcon name="garage" size={24}/><span><b>Aracını garajına ekle</b><small>Araç bilgilerin her zaman elinin altında</small></span></div>
    <div><SiteIcon name="truck" size={24}/><span><b>Tek noktadan tedarik</b><small>Birleştirilmiş sevkiyat operasyonu</small></span></div>
    <div><SiteIcon name="support" size={24}/><span><b>Servisler için B2B</b><small>Onaylı hesaplara özel fiyatlar</small></span></div>
  </div></section>;
}
