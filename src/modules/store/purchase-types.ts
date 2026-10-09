export type PurchasePreview = {
  id: string; name: string; code: string; brand: string; price: number;
  quantity: number; maxQuantity: number; image: string | null; stockLabel: string;
};
export type PurchaseState = { error: string | null; added: PurchasePreview | null; suggestions: PurchasePreview[] };
