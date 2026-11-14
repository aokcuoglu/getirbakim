"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// recharts is only used on Başbuğ's Senkronizasyon tab: it loads after the page instead of with it.
export const GroupFreshnessChart = dynamic(() => import("@/components/admin/basbug-sync-charts").then(module => module.GroupFreshnessChart),
  { ssr: false, loading: () => <Skeleton className="mx-auto aspect-square h-48"/> });
export const RunDurationChart = dynamic(() => import("@/components/admin/basbug-sync-charts").then(module => module.RunDurationChart),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full"/> });
