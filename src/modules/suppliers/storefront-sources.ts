// Supplier companies whose current observations are sold on the storefront (see commerce_supplier_items).
// Kept free of server imports: catalog helpers that read it are also used by admin pages.
export const setaCompany = "SETA";
export const storefrontCompanies = () => [process.env.BASBUG_FIRMA_ADI || "BASBUG", setaCompany];
