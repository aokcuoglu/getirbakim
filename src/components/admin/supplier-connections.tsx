import Link from "next/link";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { StatusBadge, TableRegion } from "@/components/admin/ui";

export function SupplierConnections() {
  return <TableRegion label="Tedarikçi bağlantıları"><table className="admin-table"><thead><tr><th>Tedarikçi</th><th>Bağlantı</th><th>Not</th></tr></thead><tbody>
    {supplierStatuses().map(s=><tr key={s.name}>
      <td><strong>{s.name}</strong>{s.name === "Başbuğ" && <small><Link className="admin-link" href="/yonetim/tedarikciler/basbug">Verileri incele →</Link></small>}</td>
      <td><StatusBadge tone={s.configured ? "success" : "warning"}>{s.configured ? "Değişkenler tanımlı" : "Değişken eksik"}</StatusBadge></td>
      <td><small>{s.message}</small></td>
    </tr>)}
  </tbody></table></TableRegion>;
}
