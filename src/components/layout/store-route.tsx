"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The storefront chrome has three route variants:
 * - "home": the front page (compact centred header on phones, collapsible footer groups),
 * - "checkout": the order page (logo-only header, the full footer grid),
 * - "standard": every other storefront route.
 */
export type StoreRoute = "home" | "checkout" | "standard";

export function useStoreRoute(): StoreRoute {
  const pathname = usePathname();
  if (pathname === "/") return "home";
  if (pathname.startsWith("/siparis-olustur")) return "checkout";
  return "standard";
}

/**
 * Wraps chrome that changes with the route. Descendants style themselves with
 * `group-data-[route=home]/route:` / `group-data-[route=checkout]/route:` variants,
 * so server-rendered children need no route knowledge of their own.
 */
export function RouteFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-route={useStoreRoute()} className={cn("group/route", className)}>{children}</div>;
}

/** Picks the footer variant that is actually visible on the current route. */
export function FooterVariants({ links, checkout }: { links: ReactNode; checkout: ReactNode }) {
  return useStoreRoute() === "checkout" ? checkout : links;
}

/** `matchMedia` as React state; false during server rendering. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback((callback: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
