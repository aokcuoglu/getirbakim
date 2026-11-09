"use client";
import { useFormStatus } from "react-dom";
import { CircleCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function ManualSubmitButton({ label, pendingLabel, icon = "upload", disabled = false, variant = "default" }: {
  label: string; pendingLabel: string; icon?: "upload" | "check"; disabled?: boolean; variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  const Icon = icon === "upload" ? Upload : CircleCheck;
  return <Button type="submit" variant={variant} disabled={pending || disabled} aria-live="polite">{pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Icon data-icon="inline-start" aria-hidden="true"/>}{pending ? pendingLabel : label}</Button>;
}
