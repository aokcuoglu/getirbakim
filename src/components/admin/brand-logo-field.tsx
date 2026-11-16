"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, EyeOff, Link2, RotateCcw } from "lucide-react";
import { removeBrandLogo, resetBrandLogo, setBrandLogoFromUrl, uploadBrandLogo, type BrandLogoActionResult } from "@/app/yonetim/urun-eslestirme/logo-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { brandLogoLimits, brandLogoTypes } from "@/modules/admin/brand-logo-limits";
import { remoteImageUrlMaxLength } from "@/modules/admin/product-image-limits";
import type { BrandLogoSource } from "@/modules/store/manufacturer-logos";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export type BrandLogoState = { logo: { src: string; width: number; height: number } | null; source: BrandLogoSource | null; automatic: boolean };

const sourceHints: Record<"manual" | "static" | "enrichment", { label: string; title: string }> = {
  manual: { label: "Elle", title: "Yöneticinin yüklediği logo" },
  static: { label: "Hazır", title: "Sitenin hazır logo dosyalarından" },
  enrichment: { label: "Otomatik", title: "Zenginleştirmede bulunan logo" },
};
const maxMegabytes = brandLogoLimits.maxBytes / 1024 / 1024;
const lost: BrandLogoActionResult = { status: "error", message: "Bağlantı kesildi; yeniden deneyin." };

/** Whether the store shows a logo for the brand (#819), and where it comes from. */
export function BrandLogoStatus({ state }: { state: BrandLogoState }) {
  if (state.source === "hidden") return <StatusBadge tone="neutral" title="Yönetici logoyu kaldırdı; otomatik logo da gösterilmez">Gizli</StatusBadge>;
  if (!state.logo || !state.source) return <StatusBadge tone="warning" title="Mağazada bu marka logosuz görünür">Logo yok</StatusBadge>;
  const hint = sourceHints[state.source];
  return <StatusBadge tone="success" title={hint.title}>Logo var · {hint.label}</StatusBadge>;
}

/** The brand's logo as the store shows it: an admin's file or URL, hidden, or back to the automatic one. */
export function BrandLogoField({ brandId, brandName, state }: { brandId: string; brandName: string; state: BrandLogoState }) {
  const router = useRouter();
  const fileId = useId();
  const urlId = useId();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<BrandLogoActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const stored = state.source === "manual" || state.source === "hidden";

  const mutate = (action: () => Promise<BrandLogoActionResult>, after?: () => void) => {
    setResult(null);
    startTransition(async () => {
      const next = await action().catch(() => lost);
      setResult(next);
      if (next.status === "success") after?.();
      router.refresh();
    });
  };

  const upload = (file: File | undefined) => {
    if (!file || pending) return;
    // Checked here too so a wrong or oversized file is not sent at all; the action checks again.
    if (!brandLogoTypes.some(type => type === file.type)) return setResult({ status: "error", message: "Yalnız PNG, SVG, WebP veya JPEG logo yüklenebilir." });
    if (file.size > brandLogoLimits.maxBytes) return setResult({ status: "error", message: `Logo en çok ${maxMegabytes} MB olabilir.` });
    const form = new FormData();
    form.set("brand_id", brandId);
    form.set("file", file);
    mutate(() => uploadBrandLogo(form));
  };

  const fetchUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = url.trim();
    if (!value || pending) return;
    mutate(() => setBrandLogoFromUrl({ brandId, url: value }), () => setUrl(""));
  };

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="font-medium">Logo</h3>
      <BrandLogoStatus state={state}/>
    </div>
    {state.logo ? <Image src={state.logo.src} alt={`${brandName} logosu`} width={state.logo.width} height={state.logo.height} unoptimized
      className="h-16 w-40 object-contain object-left"/>
      : <p className="text-muted-foreground">{state.source === "hidden" ? "Mağazada logo gösterilmiyor." : "Bu markanın logosu yok; dosya yükleyin ya da adresten alın."}</p>}
    <Field>
      <FieldLabel htmlFor={fileId}>Logo dosyası</FieldLabel>
      <Input id={fileId} type="file" accept={brandLogoTypes.join(",")} disabled={pending}
        onChange={event => { upload(event.target.files?.[0]); event.target.value = ""; }}/>
      <FieldDescription>PNG, SVG, WebP veya JPEG · en çok {maxMegabytes} MB. Logo WebP&apos;ye çevrilir, kenar boşluğu kırpılır ve en çok {brandLogoLimits.maxWidth}×{brandLogoLimits.maxHeight} piksele sığdırılır.</FieldDescription>
    </Field>
    <form className="flex flex-col gap-2" noValidate onSubmit={fetchUrl}>
      <Field>
        <FieldLabel htmlFor={urlId}>Ya da logo adresi (URL)</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup>
            <InputGroupAddon><Link2 aria-hidden="true"/></InputGroupAddon>
            <InputGroupInput id={urlId} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/logo.svg"
              maxLength={remoteImageUrlMaxLength} value={url} readOnly={pending} onChange={event => setUrl(event.target.value)}/>
          </InputGroup>
          <Button type="submit" variant="outline" className="w-full sm:w-auto" disabled={pending || !url.trim()}>
            <Link2 data-icon="inline-start" aria-hidden="true"/>Adresten al</Button>
        </div>
        <FieldDescription>Logo sunucuda indirilir; yalnız herkese açık PNG, SVG, WebP veya JPEG adresleri alınabilir.</FieldDescription>
      </Field>
    </form>
    {(state.logo || stored) && <div className="flex flex-wrap gap-2">
      {state.logo && <Button type="button" variant="outline" disabled={pending} onClick={() => mutate(() => removeBrandLogo({ brandId }))}>
        <EyeOff data-icon="inline-start" aria-hidden="true"/>Logoyu kaldır</Button>}
      {stored && <Button type="button" variant="outline" disabled={pending} title={state.automatic ? "Hazır veya zenginleştirme logosu yeniden gösterilir" : "Bu markanın otomatik logosu yok; mağazada logosuz görünür"}
        onClick={() => mutate(() => resetBrandLogo({ brandId }))}><RotateCcw data-icon="inline-start" aria-hidden="true"/>Otomatik logoya dön</Button>}
    </div>}
    <div className="flex flex-col gap-2 empty:hidden" aria-live="polite">
      {pending && <span className="flex items-center gap-2 text-muted-foreground"><Spinner aria-hidden="true"/>Logo kaydediliyor…</span>}
      {result?.status === "success" && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    </div>
    {result?.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/>
      <AlertDescription><span className="wrap-anywhere">{result.message}</span></AlertDescription></Alert>}
  </div>;
}
