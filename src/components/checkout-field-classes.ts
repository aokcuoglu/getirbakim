/**
 * Checkout form field classes shared by the page and its address and invoice fields (#881). Controls use 16px text on
 * phones so iOS Safari does not zoom into a focused field.
 */
export const checkoutLabel = "gap-1 text-sm leading-5 font-normal";
export const checkoutControl = "h-[52px] rounded-[5px] bg-white px-3.5 py-3 text-base md:text-sm user-invalid:border-destructive";
export const checkoutTextarea = "field-sizing-fixed resize-y rounded-[5px] bg-white px-3.5 py-3 text-base md:text-sm user-invalid:border-destructive";
/** The combobox's input group carries the frame; its input keeps the control's text and padding. */
export const checkoutCombobox = "h-[52px] w-full rounded-[5px] bg-white *:data-[slot=input-group-control]:h-full *:data-[slot=input-group-control]:px-3.5";
export const checkoutRequiredMark = "text-[#ba3c28]";
/** Checkboxes keep a 20px box with a 44px touch target (#999). */
export const checkoutCheckbox = "my-0.5 size-5 after:-inset-3";
/** The saved-address select wrapper: the native select takes the control's size, frame and text. */
export const checkoutSelect = "w-full *:data-[slot=native-select]:h-[52px] *:data-[slot=native-select]:rounded-[5px] *:data-[slot=native-select]:bg-white *:data-[slot=native-select]:px-3.5 *:data-[slot=native-select]:text-base md:*:data-[slot=native-select]:text-sm";
