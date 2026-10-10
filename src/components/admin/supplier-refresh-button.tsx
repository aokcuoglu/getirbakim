"use client";
import { useFormStatus } from "react-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SupplierRefreshButton({ label = "Seçili grubu API’den güncelle" }: { label?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} aria-live="polite"><RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true"/>{pending ? "Başbuğ verileri çekiliyor…" : label}</Button>;
}
