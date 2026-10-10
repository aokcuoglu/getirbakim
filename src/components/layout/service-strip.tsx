"use client";
import { usePathname } from "next/navigation";
import { SiteIcon } from "@/components/site/site-icon";

// Consumer reassurance band; the administration workspace has no use for it.
// TODO: render from a (store) route-group layout instead once storefront routes move into one.
export function ServiceStrip() {
  if (usePathname().startsWith("/yonetim")) return null;
  return <section className="service-strip"><div className="shell">
    <div><SiteIcon name="lens" size={24}/><span><b>Kolay parça arama</b><small>Ürün adı, kodu veya OEM numarasıyla</small></span></div>
    <div><SiteIcon name="garage" size={24}/><span><b>Aracını garajına ekle</b><small>Araç bilgilerin her zaman elinin altında</small></span></div>
    <div><SiteIcon name="truck" size={24}/><span><b>Tek noktadan tedarik</b><small>Birleştirilmiş sevkiyat operasyonu</small></span></div>
    <div><SiteIcon name="support" size={24}/><span><b>Alışveriş desteği</b><small>Soruların için yardım merkezi</small></span></div>
  </div></section>;
}
