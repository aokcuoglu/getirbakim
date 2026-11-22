/** Turkish lira display of a kuruş amount; kept free of server imports so pure modules can format prices. */
export function money(kurus: number) { return new Intl.NumberFormat("tr-TR",{ style:"currency", currency:"TRY" }).format(kurus/100); }
/** A service account's price: the price less its discount percent, rounded to the kuruş. */
export function servicePrice(price: number, discount: number) { return Math.round(price * (100-discount) / 100); }
