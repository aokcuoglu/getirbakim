"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { HeaderPin } from "./header-pin";

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
 * Wraps chrome that changes with the route (`except`: renders nothing on that route; `pin`: mounts HeaderPin, #1089). Descendants style themselves with
 * `group-data-[route=home]/route:` / `group-data-[route=checkout]/route:` variants,
 * so server-rendered children need no route knowledge of their own.
 */
export function RouteFrame({ children, className, except, pin }: { children: ReactNode; className?: string; except?: StoreRoute; pin?: boolean }) {
  const route = useStoreRoute();
  if (route === except) return null;
  return <div data-route={route} className={cn("group/route", className)}>{pin && <HeaderPin route={route} />}{children}</div>;
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
