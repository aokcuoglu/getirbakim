import type { SupplierAdapter } from "./types";
import { getSupplierMode, isSupplierAEnabled } from "./config";

const ADAPTERS: Record<string, { new (): SupplierAdapter }> = {};

export function registerAdapter(slug: string, adapterClass: { new (): SupplierAdapter }) {
  ADAPTERS[slug] = adapterClass;
}

export function getAdapter(slug: string): SupplierAdapter | null {
  const AdapterClass = ADAPTERS[slug];
  if (!AdapterClass) return null;
  return new AdapterClass();
}

export function getAllAdapters(): SupplierAdapter[] {
  const mode = getSupplierMode();

  if (mode === "mock") {
    const MockAdapter = ADAPTERS["mock"];
    return MockAdapter ? [new MockAdapter()] : [];
  }

  if (mode === "live") {
    return Object.entries(ADAPTERS)
      .filter(([slug]) => slug !== "mock")
      .map(([, AdapterClass]) => new AdapterClass());
  }

  // hybrid: use live adapters when enabled, always include mock as fallback
  const liveAdapters: SupplierAdapter[] = [];
  const MockAdapter = ADAPTERS["mock"];

  if (ADAPTERS["supplier-a"] && isSupplierAEnabled()) {
    liveAdapters.push(new ADAPTERS["supplier-a"]());
  }

  for (const [slug, AdapterClass] of Object.entries(ADAPTERS)) {
    if (slug === "mock" || slug === "supplier-a") continue;
    const instance = new AdapterClass();
    if (instance.apiKey && instance.baseUrl) {
      liveAdapters.push(instance);
    }
  }

  if (MockAdapter) {
    liveAdapters.push(new MockAdapter());
  }

  return liveAdapters;
}

import { MockSupplierAdapter } from "./mock";
import { SupplierAAdapter } from "./supplier-a";
import { SupplierBAdapter } from "./supplier-b";
import { SupplierCAdapter } from "./supplier-c";

registerAdapter("mock", MockSupplierAdapter);
registerAdapter("supplier-a", SupplierAAdapter);
registerAdapter("supplier-b", SupplierBAdapter);
registerAdapter("supplier-c", SupplierCAdapter);