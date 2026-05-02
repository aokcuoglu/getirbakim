import { Suspense } from "react";
import RequestFormContent from "./request-content";

export const metadata = {
  title: "Talep Oluştur",
};

export default function RequestPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl px-4 py-8 animate-pulse"><div className="h-8 bg-gray-200 rounded w-1/3 mb-4" /><div className="h-64 bg-gray-100 rounded" /></div>}>
      <RequestFormContent />
    </Suspense>
  );
}