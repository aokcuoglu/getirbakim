// Client-safe: the "Fiyat" form's values (#580) as a pure reducer, the same rules as the store card form
// (product-override-form-state.ts), tested in scripts/test-product-pricing.ts.
import type { ProductPriceResult, ProductPriceValues } from "./product-override-fields";

/** What the inputs hold: lira as typed ("1249,90"), campaign times as datetime-local values; "" is the formula. */
export type PriceFormValues = { price: string; sale_price: string; sale_from: string; sale_until: string };
export type PriceFormState = {
  values: PriceFormValues;
  /** The stored prices the form last adopted; a save carries it so a newer save elsewhere is not overwritten. */
  version: string;
  /** Inputs edited since the last adopted save: never overwritten by a version arriving from elsewhere. */
  dirty: (keyof PriceFormValues)[];
};
export type PriceFormAction =
  | { type: "edit"; values: Partial<PriceFormValues> }
  | { type: "result"; result: ProductPriceResult }
  | { type: "server"; values: ProductPriceValues | null; version: string };

/** Kuruş as the input shows it: "1249,90", whole lira without decimals ("1250"). */
export function liraInput(kurus: number | null) {
  if (kurus === null) return "";
  const whole = Math.trunc(kurus / 100), rest = kurus % 100;
  return rest ? `${whole},${String(rest).padStart(2, "0")}` : String(whole);
}

export function priceFormValues(values: ProductPriceValues | null): PriceFormValues {
  return { price: liraInput(values?.price_kurus ?? null), sale_price: liraInput(values?.sale_price_kurus ?? null),
    sale_from: values?.sale_from ?? "", sale_until: values?.sale_until ?? "" };
}

/** Inputs a revert returns to the stored value: the fixed price alone, or the campaign with its window. */
const resetInputs: Record<NonNullable<ProductPriceResult["reset"]>, (keyof PriceFormValues)[]> = {
  price_kurus: ["price"], sale_price_kurus: ["sale_price", "sale_from", "sale_until"],
};

export function initialPriceForm(values: ProductPriceValues | null, version: string): PriceFormState {
  return { values: priceFormValues(values), version, dirty: [] };
}

/**
 * - edit: what the admin types.
 * - result: a successful save shows every stored value; a successful revert shows the stored values of its inputs only
 *   and keeps unsaved input in the others; an error keeps everything as typed.
 * - server: the page was rendered with another version. Untouched inputs take the stored values; edited ones keep what
 *   the admin typed, and so does the version while anything is edited, so the next save is refused as stale.
 */
export function priceFormReducer(state: PriceFormState, action: PriceFormAction): PriceFormState {
  switch (action.type) {
    case "edit": {
      const edited = Object.keys(action.values) as (keyof PriceFormValues)[];
      return { ...state, values: { ...state.values, ...action.values }, dirty: [...new Set([...state.dirty, ...edited])] };
    }
    case "result": {
      const { result } = action;
      if (result.status !== "success" || !result.values || result.version === undefined) return state;
      const stored = priceFormValues(result.values);
      if (!result.reset) return { values: stored, version: result.version, dirty: [] };
      const inputs = resetInputs[result.reset], values = { ...state.values };
      for (const key of inputs) values[key] = stored[key];
      return { values, version: result.version, dirty: state.dirty.filter(key => !inputs.includes(key)) };
    }
    case "server": {
      if (action.version === state.version) return state;
      const values = priceFormValues(action.values);
      for (const key of state.dirty) values[key] = state.values[key];
      return { values, version: state.dirty.length ? state.version : action.version, dirty: state.dirty };
    }
  }
}
