"use client";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Errors of /yonetim pages render here, inside the workspace layout (the sidebar stays); errors of the layout itself
// reach src/app/error.tsx. Kept light: error boundaries are client components shipped with every workspace route.
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className="flex flex-col gap-4">
    <h1 className="text-2xl font-semibold tracking-tight">Sayfa açılamadı</h1>
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden="true"/>
      <AlertTitle>Veriler yüklenirken bir hata oluştu.</AlertTitle>
      <AlertDescription>Lütfen yeniden deneyin. Sorun sürerse sayfayı yenileyin{error.digest ? `; hata kodu: ${error.digest}` : ""}.</AlertDescription>
    </Alert>
    <Button className="self-start" variant="outline" onClick={() => retry()}><RotateCcw data-icon="inline-start" aria-hidden="true"/>Yeniden dene</Button>
  </div>;
}
