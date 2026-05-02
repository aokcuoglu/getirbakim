import { Suspense } from "react";
import SupplierLogsContent from "./logs-content";

export const metadata = {
  title: "Tedarikçi API Logları — Admin",
};

export default function SupplierLogsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      }
    >
      <SupplierLogsContent />
    </Suspense>
  );
}