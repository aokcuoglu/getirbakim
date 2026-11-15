"use client";

import { useEffect, useId, useRef, useState, useTransition, type DragEvent, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, EyeOff, GitMerge, ImagePlus, Link2, Star, Trash2 } from "lucide-react";
import { addProductImageFromUrl, finishProductImageUpload, removeProductImage, reorderProductImages, setAutomaticImageHidden, uploadProductImage, type ProductImageActionResult } from "@/app/yonetim/urunler/image-actions";
import { productImageLimits, productImageTypes, remoteImageUrlMaxLength } from "@/modules/admin/product-image-limits";
import type { ProductImages } from "@/modules/admin/product-image-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

type Upload = ProductImages["images"][number];
const maxMegabytes = productImageLimits.maxBytes / 1024 / 1024;

/**
 * Uploads (drop or pick several files; sent one at a time) or an image URL the server downloads (#725), order, primary image, delete and the automatic image's
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
  const list = useRef<HTMLDivElement>(null);
  // The arrow button to focus again once a move is stored and the list re-rendered (the button is disabled meanwhile).
  const focusAfterMove = useRef<{ id: string; direction: "up" | "down" } | null>(null);
  const switchId = useId();
  const urlId = useId();
  const [url, setUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const remaining = productImageLimits.maxImages - images.length;

  useEffect(() => {
    const target = focusAfterMove.current;
    if (pending || !target || !list.current) return;
    focusAfterMove.current = null;
    const button = (direction: string) => list.current?.querySelector<HTMLButtonElement>(`[data-image="${target.id}"][data-move="${direction}"]:not(:disabled)`);
    (button(target.direction) ?? button(target.direction === "up" ? "down" : "up"))?.focus();
  }, [images, pending]);

  const upload = (files: File[]) => {
    if (!files.length || pending) return;
    const failed: string[] = [];
    // Checked here too so a wrong or oversized file is not sent at all; the action checks again.
    const accepted = files.filter(file => {
      if (!productImageTypes.some(type => type === file.type)) failed.push(`${file.name}: Yalnız JPEG, PNG veya WebP yüklenebilir.`);
      else if (file.size > productImageLimits.maxBytes) failed.push(`${file.name}: Görsel en çok ${maxMegabytes} MB olabilir.`);
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
      // The cached store pages are refreshed once for the whole batch.
      if (added) await finishProductImageUpload(productId).catch(() => undefined);
      setProgress(null);
      setErrors(failed);
      setNotice(added ? `${added} görsel eklendi.` : null);
      router.refresh();
    });
  };

  const addFromUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = url.trim();
    if (!value || pending) return;
    setNotice(null);
    setErrors([]);
    setFetchingUrl(true);
    startTransition(async () => {
      const result = await addProductImageFromUrl({ productId, url: value }).catch((): ProductImageActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
      if (result.status === "error") setErrors([result.message]);
      else {
        await finishProductImageUpload(productId).catch(() => undefined);
        setNotice(result.message);
        setUrl("");
      }
      setFetchingUrl(false);
      router.refresh();
    });
  };

  const mutate = (action: () => Promise<ProductImageActionResult>, success?: string) => {
    setNotice(null);
    setErrors([]);
    startTransition(async () => {
      const result = await action().catch((): ProductImageActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
      if (result.status === "error") setErrors([result.message]);
      else setNotice(success ?? result.message);
      router.refresh();
    });
  };
  const move = (from: number, to: number, direction?: "up" | "down") => {
    const ids = images.map(image => image.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    focusAfterMove.current = direction ? { id: moved, direction } : null;
    const name = images[from].file_name || `Görsel ${from + 1}`;
    mutate(() => reorderProductImages({ productId, imageIds: ids }), to === 0 ? `“${name}” ana görsel yapıldı.` : `“${name}” ${to + 1}. sıraya taşındı.`);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    upload([...event.dataTransfer.files]);
  };

  return <div className="flex flex-col gap-4">
    <Card size="sm" className={dragging ? "ring-2 ring-ring" : undefined} onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={drop}>
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><ImagePlus/></EmptyMedia>
            <EmptyTitle>{dragging ? "Görselleri bırakın" : "Görselleri sürükleyip bırakın"}</EmptyTitle>
            <EmptyDescription>JPEG, PNG veya WebP · en çok {maxMegabytes} MB · {productImageLimits.maxImages} görsel{remaining > 0 ? ` (${remaining} yer kaldı)` : ""}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <input ref={input} className="hidden" type="file" multiple accept={productImageTypes.join(",")} aria-hidden="true" tabIndex={-1}
              onChange={event => { upload([...event.target.files ?? []]); event.target.value = ""; }}/>
            <Button type="button" variant="outline" aria-label="Ürün görseli için dosya seç" disabled={pending || remaining <= 0} onClick={() => input.current?.click()}>
              <ImagePlus data-icon="inline-start" aria-hidden="true"/>Dosya seç</Button>
            <form className="flex w-full max-w-lg flex-col gap-2" onSubmit={addFromUrl}>
              <Field>
                <FieldLabel htmlFor={urlId}>Ya da görsel adresi (URL)</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <InputGroup>
                    <InputGroupAddon><Link2 aria-hidden="true"/></InputGroupAddon>
                    <InputGroupInput id={urlId} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/gorsel.jpg"
                      maxLength={remoteImageUrlMaxLength} value={url} disabled={pending || remaining <= 0} onChange={event => setUrl(event.target.value)}/>
                  </InputGroup>
                  <Button type="submit" variant="outline" disabled={pending || remaining <= 0 || !url.trim()}>
                    {fetchingUrl ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Link2 data-icon="inline-start" aria-hidden="true"/>}
                    {fetchingUrl ? "Ekleniyor…" : "URL'den ekle"}</Button>
                </div>
                <FieldDescription>Görsel sunucuda indirilir; yalnız herkese açık JPEG, PNG veya WebP adresleri eklenebilir.</FieldDescription>
              </Field>
            </form>
            {remaining <= 0 && <p className="text-muted-foreground">Görsel sınırına ulaşıldı; yeni görsel için önce birini silin.</p>}
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>

    {errors.length > 0 && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/>
      <AlertDescription>{errors.length === 1 ? <span className="wrap-anywhere">{errors[0]}</span>
        : <ul className="flex list-disc flex-col gap-1 pl-4">{errors.map((error, index) => <li key={`${index}-${error}`} className="wrap-anywhere">{error}</li>)}</ul>}</AlertDescription></Alert>}
    {/* Always rendered so screen readers hear the upload progress and the result. */}
    <div className="flex flex-col gap-4 empty:hidden" aria-live="polite">
      {progress && <Progress value={progress.total ? ((progress.done + 1) / progress.total) * 100 : 0}>
        <ProgressLabel>Yükleniyor: {progress.done + 1}/{progress.total}</ProgressLabel>
      </Progress>}
      {notice && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{notice}</AlertDescription></Alert>}
    </div>

    {images.length > 0 && <ItemGroup ref={list} className="gap-2" aria-label="Yüklenen görseller">
      {images.map((image, index) => {
        const name = image.file_name || `Görsel ${index + 1}`;
        return <Item key={image.id} variant="outline" className="flex-wrap">
          <ItemMedia variant="image" className="size-16"><Image src={image.src} alt="" width={image.width} height={image.height} unoptimized/></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full truncate" title={name}>{name}</ItemTitle>
            <ItemDescription className="tabular-nums">{image.width}×{image.height} px</ItemDescription>
            <div className="flex flex-wrap gap-2">
              {index === 0 && <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Ana görsel</Badge>}
              {image.carried && <Badge variant="info"><GitMerge data-icon="inline-start" aria-hidden="true"/>Birleştirmeden taşındı</Badge>}
            </div>
          </ItemContent>
          <ItemActions className="w-full flex-wrap sm:w-auto">
            <Button type="button" variant="outline" size="icon" data-image={image.id} data-move="up" aria-label={`${name} görselini yukarı taşı`} disabled={pending || index === 0} onClick={() => move(index, index - 1, "up")}><ArrowUp aria-hidden="true"/></Button>
            <Button type="button" variant="outline" size="icon" data-image={image.id} data-move="down" aria-label={`${name} görselini aşağı taşı`} disabled={pending || index === images.length - 1} onClick={() => move(index, index + 1, "down")}><ArrowDown aria-hidden="true"/></Button>
            {index > 0 && <Button type="button" variant="outline" disabled={pending} onClick={() => move(index, 0)}><Star data-icon="inline-start" aria-hidden="true"/>Ana görsel yap</Button>}
            <Dialog>
              <DialogTrigger render={<Button type="button" variant="destructive" disabled={pending}/>}><Trash2 data-icon="inline-start" aria-hidden="true"/>Sil</DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Görsel silinsin mi?</DialogTitle>
                  <DialogDescription>“{name}” mağazadan ve bu üründen kaldırılır.{index === 0 && images.length > 1 ? " Sıradaki görsel ana görsel olur." : ""}</DialogDescription></DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline"/>}>Vazgeç</DialogClose>
                  <DialogClose render={<Button type="button" variant="destructive"/>} onClick={() => mutate(() => removeProductImage({ productId, imageId: image.id }))}>
                    <Trash2 data-icon="inline-start" aria-hidden="true"/>Görseli sil</DialogClose>
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
        <ItemMedia variant="image" className="size-16"><Image src={image.src} alt="" width={image.width} height={image.height} unoptimized/></ItemMedia>
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
