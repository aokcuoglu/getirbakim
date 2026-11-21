"use client";

import { useEffect } from "react";
import type { StoreRoute } from "./store-route";
import { nextHeaderPin, type PinTrack } from "./header-pin-state";

const phoneQuery = "(max-width: 599.98px)";
const lockedOverflow = /hidden|clip/;

/**
 * Phones (#1089): the header slides away while scrolling down and its logo/tools and search rows come back on the
 * way up. Writes body[data-header-pin] (see header-pin-state.ts) and --header-pin-h, the pinned rows' height, for
 * the `.site-chrome` rules in storefront.css; renders nothing. Off on checkout and from 600px up; while a dialog
 * locks the page scroller (overflow hidden on <html> or <body>, as Base UI does) the state does not change.
 */
export function HeaderPin({ route }: { route: StoreRoute }) {
  useEffect(() => {
    if (route === "checkout") return;
    const chrome = document.querySelector<HTMLElement>(".site-chrome");
    const row = chrome?.querySelector<HTMLElement>(".site-header-row");
    if (!chrome || !row) return;
    const root = document.documentElement;
    const body = document.body;
    const phone = window.matchMedia(phoneQuery);
    let headerHeight = chrome.offsetHeight;
    let track: PinTrack = { pin: null, anchor: 0 };
    let frame = 0;

    const measure = () => {
      headerHeight = chrome.offsetHeight;
      root.style.setProperty("--header-pin-h", `${row.offsetHeight}px`);
    };
    const clear = () => {
      track = { pin: null, anchor: 0 };
      delete body.dataset.headerPin;
    };
    const update = () => {
      frame = 0;
      if (!phone.matches) return;
      // Clamped so the iOS rubber band past either end does not flip the header.
      const y = Math.min(Math.max(window.scrollY, 0), Math.max(root.scrollHeight - window.innerHeight, 0));
      const next = nextHeaderPin(track, y, headerHeight);
      if (next.pin !== track.pin) {
        // Style is read only when the pin would flip: a scroll lock keeps the header as it is.
        if (lockedOverflow.test(getComputedStyle(root).overflowY) || lockedOverflow.test(getComputedStyle(body).overflowY)) return;
        if (next.pin) body.dataset.headerPin = next.pin;
        else delete body.dataset.headerPin;
      }
      track = next;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const onPhoneChange = () => { clear(); measure(); };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    window.addEventListener("scroll", onScroll, { passive: true });
    phone.addEventListener("change", onPhoneChange);
    onScroll();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      phone.removeEventListener("change", onPhoneChange);
      clear();
      root.style.removeProperty("--header-pin-h");
    };
  }, [route]);
  return null;
}
