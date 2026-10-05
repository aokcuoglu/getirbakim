import "@/styles/supplier-admin.css";
import Link from "next/link";
import { requireAdmin } from "@/modules/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <div className="admin-workspace"><nav className="shell commerce-nav" aria-label="Yönetim"><Link href="/yonetim">Genel bakış</Link><Link href="/yonetim/fiyatlandirma">Fiyatlandırma</Link><Link href="/yonetim/servisler">B2B servisler</Link><Link href="/yonetim/siparisler">Siparişler</Link><Link href="/yonetim/tedarikciler/basbug">Tedarikçi ürünleri</Link><Link href="/yonetim/urun-verileri">Ürün zenginleştirme</Link></nav>{children}</div>;
}
