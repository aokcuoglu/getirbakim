// The storefront's dialog shell (DESIGN.md): centred card on desktop, bottom sheet on phones. Shared by the payment
// and order-cancel dialogs so both look the same.
export const storeDialogOverlay = "bg-[#212b3673] supports-backdrop-filter:backdrop-blur-none";
export const storeDialogContent = "inset-x-0 top-[12dvh] mx-auto block translate-x-0 translate-y-0 gap-0 ring-0 sm:max-w-[440px] max-[760px]:sm:max-w-none max-h-[calc(88dvh-24px)] w-[calc(100%-32px)] max-w-[440px] overflow-auto rounded-[10px] bg-white px-8 pt-9 pb-7 text-center text-foreground shadow-[0_12px_50px_#212b3626] max-[760px]:top-auto max-[760px]:bottom-0 max-[760px]:w-full max-[760px]:max-w-none max-[760px]:rounded-t-[14px] max-[760px]:rounded-b-none max-[760px]:px-5 max-[760px]:pt-8 max-[760px]:pb-[calc(20px+env(safe-area-inset-bottom))]";
export const storeDialogAction = "h-auto min-h-12 w-full gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5";
