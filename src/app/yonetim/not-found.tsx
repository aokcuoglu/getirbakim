import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// notFound() in workspace pages renders here, inside the workspace shell (the root not-found carries the storefront chrome).
export default function AdminNotFound() {
  return <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon"><SearchX/></EmptyMedia>
      <EmptyTitle><h1>Kayıt bulunamadı</h1></EmptyTitle>
      <EmptyDescription>Aradığın kayıt silinmiş ya da bağlantı hatalı olabilir.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button nativeButton={false} variant="outline" render={<Link href="/yonetim"/>}>Yönetim paneline dön</Button>
    </EmptyContent>
  </Empty>;
}
