// Client-safe: the "Mağaza bilgileri" form's values (#575) as a pure reducer, so what the form shows after a save, a
// revert, an error or a page refresh is decided in one tested place (scripts/test-product-overrides.ts).
import type { ProductOverrideField, ProductOverrideResult, ProductOverrideValues } from "./product-override-fields";

/** What the inputs hold: text as typed, the category id as a string ("" = automatic), the switch as published. */
export type OverrideFormValues = {
  name: string; description: string; seo_title: string; seo_description: string; category_id: string; published: boolean;
};
export type OverrideFormState = {
  values: OverrideFormValues;
  /** The stored edits the form last adopted; a save carries it so a newer save elsewhere is not overwritten. */
  version: string;
};
export type OverrideFormAction =
  | { type: "edit"; values: Partial<OverrideFormValues> }
  | { type: "result"; result: ProductOverrideResult }
  | { type: "server"; values: ProductOverrideValues | null; version: string };

export function formValues(values: ProductOverrideValues | null): OverrideFormValues {
  return {
    name: values?.name ?? "", description: values?.description ?? "", seo_title: values?.seo_title ?? "",
    seo_description: values?.seo_description ?? "", category_id: values?.category_id === null || values?.category_id === undefined ? "" : String(values.category_id),
    published: !values?.hidden,
  };
}

const inputOf: Record<ProductOverrideField, keyof OverrideFormValues> = {
  name: "name", description: "description", seo_title: "seo_title", seo_description: "seo_description", category_id: "category_id", hidden: "published",
};

export function initialOverrideForm(values: ProductOverrideValues | null, version: string): OverrideFormState {
  return { values: formValues(values), version };
}

/**
 * - edit: what the admin types or picks.
 * - result: a successful save shows every stored value; a successful revert shows the stored value of that field only and
 *   keeps unsaved input in the others; an error keeps everything as typed.
 * - server: the page was rendered with another version (a refresh after someone else's save): adopt it. The page's own
 *   refresh after our save carries the version the result already adopted and changes nothing.
 */
export function overrideFormReducer(state: OverrideFormState, action: OverrideFormAction): OverrideFormState {
  switch (action.type) {
    case "edit":
      return { ...state, values: { ...state.values, ...action.values } };
    case "result": {
      const { result } = action;
      if (result.status !== "success" || !result.values || result.version === undefined) return state;
      const stored = formValues(result.values);
      if (!result.reset) return { values: stored, version: result.version };
      const input = inputOf[result.reset];
      return { values: { ...state.values, [input]: stored[input] }, version: result.version };
    }
    case "server":
      return action.version === state.version ? state : { values: formValues(action.values), version: action.version };
  }
}
