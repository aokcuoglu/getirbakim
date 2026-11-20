"use client";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { storeButton } from "@/components/store-button";
export default function ErrorPage({retry}:{retry:()=>void}) {return <Empty className="gap-0 rounded-2xl border border-dashed border-border bg-[#f7f8fa] px-6 py-14"><EmptyTitle className="text-[22px] leading-5 font-semibold tracking-normal"><h1>Şu anda bu alanı açamıyoruz.</h1></EmptyTitle><EmptyDescription className="mx-auto mb-6 max-w-[460px] text-sm leading-6 text-muted-foreground">Lütfen tekrar dene. Sorun sürerse Getirbakim yönetimiyle iletişime geç.</EmptyDescription><Button className={storeButton({ intent: "primary", size: "lg" })} onClick={retry}>Tekrar dene</Button></Empty>;}
