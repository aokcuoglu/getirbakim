import { Suspense } from "react";
import SupplierHealthContent from "./health-content";

export const metadata = {
  title: "Tedarikçi Durumu — Admin",
};

export default function SupplierHealthPage() {
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
      <SupplierHealthContent />
    </Suspense>
  );
}