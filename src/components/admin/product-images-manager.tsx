"use client";

import { useId, useRef, useState, useTransition, type DragEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, EyeOff, GitMerge, ImagePlus, Star, Trash2 } from "lucide-react";
import { removeProductImage, reorderProductImages, setAutomaticImageHidden, uploadProductImage, type ProductImageActionResult } from "@/app/yonetim/urunler/image-actions";
import { productImageLimits, productImageTypes } from "@/modules/admin/product-image-limits";
import type { ProductImages } from "@/modules/admin/product-image-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

type Upload = ProductImages["images"][number];

/**
 * Uploads (drop or pick several files; sent one at a time), order, primary image, delete and the automatic image's
 * visibility (#581). Every change goes through a server action; the page refreshes with the stored gallery.
 */
export function ProductImagesManager({ productId, images, hideAutomatic, automatic }: {
  productId: string;
  images: Upload[];
  hideAutomatic: boolean;
  automatic: ProductImages["automatic"];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const switchId = useId();
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const remaining = productImageLimits.maxImages - images.length;

  const upload = (files: File[]) => {
    if (!files.length || pending) return;
    const failed: string[] = [];
    // Checked here too so a wrong or oversized file is not sent at all; the action checks again.
    const accepted = files.filter(file => {
      if (!productImageTypes.some(type => type === file.type)) failed.push(`${file.name}: Yalnız JPEG, PNG veya WebP yüklenebilir.`);
      else if (file.size > productImageLimits.maxBytes) failed.push(`${file.name}: Görsel en çok 8 MB olabilir.`);
      else return true;
      return false;
    });
    const sending = accepted.slice(0, Math.max(remaining, 0));
    for (const file of accepted.slice(sending.length)) failed.push(`${file.name}: Bir ürüne en çok ${productImageLimits.maxImages} görsel eklenebilir.`);
    setNotice(null);
    setErrors([]);
    startTransition(async () => {
      let added = 0;
      for (const [index, file] of sending.entries()) {
        setProgress({ done: index, total: sending.length });
        const form = new FormData();
        form.set("product_id", productId);
        form.set("file", file);
        const result = await uploadProductImage(form).catch((): ProductImageActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
        if (result.status === "error") failed.push(`${file.name}: ${result.message}`);
        else added++;
      }
      setProgress(null);
      setErrors(failed);
      setNotice(added ? `${added} görsel eklendi.` : null);
      router.refresh();
    });
  };

  const mutate = (action: () => Promise<ProductImageActionResult>) => {
    setNotice(null);
    setErrors([]);
    startTransition(async () => {
      const result = await action().catch((): ProductImageActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
      if (result.status === "error") setErrors([result.message]);
      else setNotice(result.message);
      router.refresh();
    });
  };
  const move = (from: number, to: number) => {
    const ids = images.map(image => image.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    mutate(() => reorderProductImages({ productId, imageIds: ids }));
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    upload([...event.dataTransfer.files]);
  };

  return <div className="flex flex-col gap-4">
    <Card size="sm" onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><ImagePlus/></EmptyMedia>
            <EmptyTitle>{dragging ? "Görselleri bırakın" : "Görselleri sürükleyip bırakın"}</EmptyTitle>
            <EmptyDescription>JPEG, PNG veya WebP · en çok 8 MB · {productImageLimits.maxImages} görsel{remaining > 0 ? ` (${remaining} yer kaldı)` : ""}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <input ref={input} className="hidden" type="file" multiple accept={productImageTypes.join(",")} aria-label="Görsel dosyaları"
              onChange={event => { upload([...event.target.files ?? []]); event.target.value = ""; }}/>
            <Button type="button" variant="outline" disabled={pending || remaining <= 0} onClick={() => input.current?.click()}>
              <ImagePlus data-icon="inline-start" aria-hidden="true"/>Dosya seç</Button>
            {remaining <= 0 && <p className="text-muted-foreground">Görsel sınırına ulaşıldı; yeni görsel için önce birini silin.</p>}
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>

    {progress && <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} aria-live="polite">
      <ProgressLabel>Yükleniyor: {progress.done + 1}/{progress.total}</ProgressLabel>
    </Progress>}
    {errors.length > 0 && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/>
      <AlertDescription>{errors.length === 1 ? errors[0] : <ul className="flex list-disc flex-col gap-1 pl-4">{errors.map(error => <li key={error}>{error}</li>)}</ul>}</AlertDescription></Alert>}
    {notice && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{notice}</AlertDescription></Alert>}

    {images.length > 0 && <ItemGroup className="gap-2" aria-label="Yüklenen görseller">
      {images.map((image, index) => {
        const name = image.file_name || `Görsel ${index + 1}`;
        return <Item key={image.id} variant="outline">
          <ItemMedia variant="image" className="size-16"><Image src={image.src} alt={name} width={image.width} height={image.height} unoptimized/></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full truncate" title={name}>{name}</ItemTitle>
            <ItemDescription className="tabular-nums">{image.width}×{image.height} px</ItemDescription>
            <div className="flex flex-wrap gap-2">
              {index === 0 && <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Ana görsel</Badge>}
              {image.carried && <Badge variant="info"><GitMerge data-icon="inline-start" aria-hidden="true"/>Birleştirmeden taşındı</Badge>}
            </div>
          </ItemContent>
          <ItemActions className="flex-wrap">
            <Button type="button" variant="outline" size="icon" aria-label={`${name} görselini yukarı taşı`} disabled={pending || index === 0} onClick={() => move(index, index - 1)}><ArrowUp aria-hidden="true"/></Button>
            <Button type="button" variant="outline" size="icon" aria-label={`${name} görselini aşağı taşı`} disabled={pending || index === images.length - 1} onClick={() => move(index, index + 1)}><ArrowDown aria-hidden="true"/></Button>
            {index > 0 && <Button type="button" variant="outline" disabled={pending} onClick={() => move(index, 0)}><Star data-icon="inline-start" aria-hidden="true"/>Ana görsel yap</Button>}
            <Dialog>
              <DialogTrigger render={<Button type="button" variant="destructive" disabled={pending}/>}><Trash2 data-icon="inline-start" aria-hidden="true"/>Sil</DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Görsel silinsin mi?</DialogTitle>
                  <DialogDescription>“{name}” mağazadan ve bu üründen kaldırılır.{index === 0 && images.length > 1 ? " Sıradaki görsel ana görsel olur." : ""}</DialogDescription></DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline"/>}>Vazgeç</DialogClose>
                  <DialogClose render={<Button type="button" variant="destructive"/>} onClick={() => mutate(() => removeProductImage({ productId, imageId: image.id }))}>
                    <Trash2 data-icon="inline-start" aria-hidden="true"/>Sil</DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </ItemActions>
        </Item>;
      })}
    </ItemGroup>}

    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Otomatik görsel</h3>
      {automatic.length ? <ItemGroup className="gap-2" aria-label="Otomatik görseller">{automatic.map(image => <Item key={image.src} variant="outline">
        <ItemMedia variant="image" className="size-16"><Image src={image.src} alt={`Otomatik görsel (${image.supplier})`} width={image.width} height={image.height} unoptimized/></ItemMedia>
        <ItemContent>
          <ItemTitle>Zenginleştirme görseli</ItemTitle>
          <ItemDescription>{image.supplier} kaydından · {images.length ? "yüklenen görsellerin ardından gösterilir" : "yüklenen görsel olmadığı için ana görsel"}</ItemDescription>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Otomatik</Badge>
            {hideAutomatic && <Badge variant="warning"><EyeOff data-icon="inline-start" aria-hidden="true"/>Mağazada gizli</Badge>}
          </div>
        </ItemContent>
      </Item>)}</ItemGroup>
        : <p className="text-muted-foreground">Bu ürünün otomatik görseli yok.</p>}
      {(automatic.length > 0 || hideAutomatic) && <Field orientation="horizontal">
        <Switch id={switchId} checked={hideAutomatic} disabled={pending} onCheckedChange={checked => mutate(() => setAutomaticImageHidden({ productId, hidden: checked }))}/>
        <FieldContent>
          <FieldLabel htmlFor={switchId}>Otomatik görseli mağazada gizle</FieldLabel>
          <FieldDescription>Gizliyken mağaza yalnız yüklenen görselleri gösterir; hiç yoksa ürün görselsiz (çizimle) görünür.</FieldDescription>
        </FieldContent>
      </Field>}
    </div>
  </div>;
}
