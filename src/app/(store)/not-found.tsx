import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { storeButton } from "@/components/store-button";
export default function NotFound() {return <Empty className="mx-auto min-h-[55vh] w-full max-w-[1280px] justify-start gap-0 rounded-2xl border border-dashed border-border bg-[#f7f8fa] px-6 py-14"><EmptyTitle className="text-[22px] leading-5 font-semibold tracking-normal"><h1>Ürün bulunamadı.</h1></EmptyTitle><EmptyDescription className="mx-auto mb-6 max-w-[460px] text-sm leading-6 text-muted-foreground">Ürün koduyla yeniden arama yapabilirsin.</EmptyDescription><Button nativeButton={false} className={storeButton({ intent: "primary", size: "lg" })} render={<Link href="/"/>}>Parça ara ↗</Button></Empty>;}
