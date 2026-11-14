"use client";
import { useFormStatus } from "react-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SupplierRefreshButton({ label = "API’den güncelle", pendingLabel = "Veriler çekiliyor…" }: { label?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} aria-live="polite">{pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <RefreshCw data-icon="inline-start" aria-hidden="true"/>}{pending ? pendingLabel : label}</Button>;
}
