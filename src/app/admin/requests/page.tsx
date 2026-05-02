import { Suspense } from "react";
import AdminRequestsContent from "./requests-content";

export const metadata = {
  title: "Talepler — Admin",
};

export default function AdminRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="animate-pulse h-8 bg-gray-200 rounded w-1/3 mb-6" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      }
    >
      <AdminRequestsContent />
    </Suspense>
  );
}