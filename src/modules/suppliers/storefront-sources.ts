// Supplier companies whose current observations are sold on the storefront (see commerce_supplier_items).
// Kept free of server imports: catalog helpers that read it are also used by admin pages.
export const setaCompany = "SETA";
// Same value as DINAMIK_COMPANY in dinamik-import.ts, repeated here to keep this module import-free.
export const dinamikCompany = "DINAMIK";
// Every manual xlsx list (manual-import.ts) shares this company; the list is the item's list_group.
export const manualCompany = "MANUEL";
export const storefrontCompanies = () => [process.env.BASBUG_FIRMA_ADI || "BASBUG", setaCompany, dinamikCompany, manualCompany];
