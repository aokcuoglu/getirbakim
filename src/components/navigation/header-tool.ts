import { cn } from "@/lib/utils";

/** Shared look of the account and garage buttons in the header (icon + two-line label; icon only from 1100px down). */
export const headerToolClass = cn(
  "flex min-h-11 items-center gap-2.5 rounded-md border-0 bg-transparent p-0 text-left text-sm leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground disabled:bg-transparent disabled:text-foreground",
  "max-[1100px]:[&>span]:hidden max-[600px]:w-11 max-[600px]:justify-center",
  "[&>span>strong]:flex [&>span>strong]:max-w-[115px] [&>span>strong]:items-center [&>span>strong]:gap-[5px] [&>span>strong]:overflow-hidden [&>span>strong]:text-ellipsis [&>span>strong]:text-sm [&>span>strong]:leading-5 [&>span>strong]:font-medium",
  "[&>span>small]:block [&>span>small]:max-w-[115px] [&>span>small]:overflow-hidden [&>span>small]:text-[13px] [&>span>small]:leading-[18px] [&>span>small]:text-ellipsis [&>span>small]:whitespace-nowrap [&>span>small]:text-muted-foreground",
  // Phones on the home page: 24px icons in the compact header.
  "group-data-[route=home]/route:max-[600px]:size-6 group-data-[route=home]/route:max-[600px]:min-h-6 group-data-[route=home]/route:max-[600px]:min-w-6 group-data-[route=home]/route:max-[600px]:gap-0 group-data-[route=home]/route:max-[600px]:[&>img]:size-6!",
);
