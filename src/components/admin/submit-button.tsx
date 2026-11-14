"use client";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Submit button of a server-action form: while the form is submitting it is disabled (no double submit) and its icon
 * turns into a spinner; `pendingLabel` replaces the label meanwhile. Pass the icon as an element
 * (`<RefreshCw data-icon="inline-start" aria-hidden="true"/>`) — server pages cannot hand a component to a client one.
 */
export function SubmitButton({ children, pendingLabel, icon, disabled, ...props }: Omit<ComponentProps<typeof Button>, "type" | "children"> & {
  children: ReactNode; pendingLabel?: ReactNode; icon?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
    {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : icon}{pending && pendingLabel ? pendingLabel : children}
  </Button>;
}
