import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { runStatusLabel, runStatusTone, type StatusTone } from "@/modules/suppliers/run-status";

/** A status in the admin's colour language: tone picks the Badge variant and icon, the text carries the meaning. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  if (tone === "success") return <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
  if (tone === "error") return <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
  if (tone === "warning") return <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
  if (tone === "info") return <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
  return <Badge variant="outline">{children}</Badge>;
}

/** Status of one supplier run (supplier_imports.status). */
export function RunStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={runStatusTone(status)}>{runStatusLabel(status)}</StatusBadge>;
}
