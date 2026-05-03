import type { Metadata } from "next";
import ExistingDbContent from "./existing-db-content";

export const metadata: Metadata = {
  title: "Katalog DB — Admin",
};

export default function ExistingDbPage() {
  return <ExistingDbContent />;
}