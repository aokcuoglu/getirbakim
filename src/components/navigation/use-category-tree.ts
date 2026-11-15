"use client";

import { useCallback, useState } from "react";
import { unpackCategoryTree, type PackedCategory, type StoreCategory } from "@/modules/store/category-tree";

// One request per page load, shared by the header menu and the catalog sidebar; a failed one is forgotten so
// "Tekrar dene" asks again.
let request: Promise<StoreCategory[]> | null = null;
let loaded: StoreCategory[] | null = null;

function fetchTree() {
  request ??= fetch("/api/categories").then(async response => {
    const data: unknown = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error("Kategoriler yüklenemedi.");
    loaded = unpackCategoryTree(data as PackedCategory[]);
    return loaded;
  }).catch(error => {
    request = null;
    throw error;
  });
  return request;
}

/** The whole category tree, fetched on the first `load()` (hover, focus or click on a trigger). */
export function useCategoryTree() {
  const [categories, setCategories] = useState<StoreCategory[] | null>(loaded);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const load = useCallback(() => {
    if (loaded) { setCategories(loaded); return; }
    setState("loading");
    fetchTree().then(tree => { setCategories(tree); setState("idle"); }, () => setState("error"));
  }, []);
  return { categories, loading: !categories && state === "loading", error: !categories && state === "error", load, retry: load };
}
