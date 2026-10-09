"use client";
import { useFormStatus } from "react-dom";

export function SupplierRefreshButton({ label = "Seçili grubu API’den güncelle" }: { label?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-live="polite">{pending ? "Başbuğ verileri çekiliyor…" : label}</button>;
}
