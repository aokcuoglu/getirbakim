"use client";

import { useId, useState, type ReactNode } from "react";

export function SupplierTabs({ transfer, products, initialTab = "products" }: {
  transfer: ReactNode;
  products: ReactNode;
  initialTab?: "transfer" | "products";
}) {
  const [active, setActive] = useState(initialTab);
  const id = useId();
  const tabs = [
    { key: "transfer" as const, label: "Veri aktarımı", number: "01" },
    { key: "products" as const, label: "Çekilmiş veriler", number: "02" },
  ];
  return <div className="supplier-tabs">
    <div className="supplier-tab-list" role="tablist" aria-label="Başbuğ yönetimi">
      {tabs.map((tab, index) => <button key={tab.key} type="button" role="tab"
        id={`${id}-${tab.key}-tab`} aria-controls={`${id}-${tab.key}-panel`}
        aria-selected={active === tab.key} tabIndex={active === tab.key ? 0 : -1}
        onClick={() => setActive(tab.key)}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : (index + 1) % 2;
          setActive(tabs[next].key);
          document.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();
        }}><span>{tab.number}</span>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <div key={tab.key} role="tabpanel" id={`${id}-${tab.key}-panel`}
      aria-labelledby={`${id}-${tab.key}-tab`} hidden={active !== tab.key} tabIndex={0}
      onClick={event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const target = event.target;
        if (target instanceof Element && target.closest('a[data-supplier-tab="products"]')) setActive("products");
      }}>
      {tab.key === "transfer" ? transfer : products}
    </div>)}
  </div>;
}
