"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// The administration workspace brings its own shell (app/yonetim/layout.tsx), so the storefront header and footer step aside there.
// TODO: render from a (store) route-group layout instead once storefront routes move into one.
export function StorefrontChrome({ children }: { children: ReactNode }) {
  return usePathname().startsWith("/yonetim") ? null : children;
}
