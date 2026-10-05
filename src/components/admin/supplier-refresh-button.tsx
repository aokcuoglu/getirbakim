"use client";
import { useFormStatus } from "react-dom";

export function SupplierRefreshButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-live="polite">{pending ? "Başbuğ verileri çekiliyor…" : "Seçili grubu API’den güncelle"}</button>;
}
