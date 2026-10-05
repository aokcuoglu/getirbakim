import { LegalPage, legalMetadata } from "@/components/legal-page";

type Props = { params: Promise<{ legalSlug: string }> };

export async function generateMetadata({ params }: Props) {
  return legalMetadata((await params).legalSlug);
}

export default async function Page({ params }: Props) {
  return <LegalPage slug={(await params).legalSlug} />;
}
