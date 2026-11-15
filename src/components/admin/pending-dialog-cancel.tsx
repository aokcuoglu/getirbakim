"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertDialogCancel } from "@/components/ui/alert-dialog";

/** Cancel button of an AlertDialog whose footer sits inside the action form: disabled while the form is submitting. */
export function PendingDialogCancel({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <AlertDialogCancel disabled={pending}>{children}</AlertDialogCancel>;
}
