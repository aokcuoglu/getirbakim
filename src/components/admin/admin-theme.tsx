"use client";
import { useEffect } from "react";

export const ADMIN_THEME_KEY = "gb-admin-theme";

// Applies the saved workspace theme after a client navigation into /yonetim (the root layout's head script only covers
// full page loads) and drops it on the way out, since the storefront has no dark theme.
export function AdminTheme() {
  useEffect(() => {
    const root = document.documentElement;
    try { root.classList.toggle("dark", localStorage.getItem(ADMIN_THEME_KEY) === "dark"); } catch {}
    return () => root.classList.remove("dark");
  }, []);
  return null;
}
