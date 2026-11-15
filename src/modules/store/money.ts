/** Turkish lira display of a kuruş amount; kept free of server imports so pure modules can format prices. */
export function money(kurus: number) { return new Intl.NumberFormat("tr-TR",{ style:"currency", currency:"TRY" }).format(kurus/100); }
