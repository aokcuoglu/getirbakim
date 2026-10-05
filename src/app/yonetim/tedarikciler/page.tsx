import Link from "next/link";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
export default async function Suppliers() {
  await requireAdmin();
  return <section className="shell page-section"><nav className="breadcrumbs" aria-label="Sayfa yolu"><Link href="/yonetim">Yönetim</Link><span aria-hidden="true">/</span><span aria-current="page">Tedarikçiler</span></nav><h1 className="page-title">Tedarikçiler</h1><div className="supplier-grid">{supplierStatuses().map(s=><article className="panel" key={s.name}><h2>{s.name}</h2><p>{s.message}</p>{s.name === "Başbuğ" && <Link className="button" href="/yonetim/tedarikciler/basbug">Verileri incele →</Link>}</article>)}</div></section>;
}
