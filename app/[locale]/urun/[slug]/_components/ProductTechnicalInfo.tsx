'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ExternalLink, FileText, Search } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import type { CatalogProductDetailView } from '@/lib/actions/catalog-store'
import type { PartCode, VehicleFitment } from '@/lib/catalog/part-enrichment'

interface Props {
  product: CatalogProductDetailView
}

interface Section {
  id: string
  title: string
  /** Gösterilen (tekilleştirilmiş) kayıt sayısı; null ise rozet çizilmez. */
  count: number | null
  /** Liste limite dayandıysa rozet "n+" olarak gösterilir. */
  hasMore?: boolean
  content: React.ReactNode
}

/** Sticky TOC yüksekliği kadar boşluk bırak ki anchor başlık altta kalmasın. */
const SCROLL_MARGIN = 'scroll-mt-24'

/**
 * Trodo tarzı teknik bilgi bloğu: soldaki accordion bölümleri public.part_*
 * verisini (özellik, araç uyumluluğu, OE/çapraz referans, barkod, doküman,
 * görsel) gösterir, sağdaki içindekiler menüsü bölümü açıp oraya kaydırır.
 * Verisi olmayan bölüm hiç render edilmez.
 */
export function ProductTechnicalInfo({ product }: Props) {
  const t = useTranslations('ProductDetail')
  const locale = useLocale()
  const [open, setOpen] = useState<string[]>(['details'])

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = []

    list.push({
      id: 'details',
      title: t('productDetails'),
      count: null,
      content: <DetailsSection product={product} />
    })

    if (product.vehicles.length > 0) {
      list.push({
        id: 'vehicles',
        title: t('compatibleVehicles'),
        count: product.vehicles.length,
        hasMore: product.hasMore.vehicles,
        content: <VehiclesSection vehicles={product.vehicles} />
      })
    }

    if (product.oems.length > 0) {
      list.push({
        id: 'oe-numbers',
        title: t('oeNumbers'),
        count: product.oems.length,
        hasMore: product.hasMore.oems,
        content: (
          <CodeGroups
            codes={product.oems}
            locale={locale}
            searchHint={t('oemSearchHint')}
          />
        )
      })
    }

    if (product.crossReferences.length > 0) {
      list.push({
        id: 'cross-references',
        title: t('crossReferences'),
        count: product.crossReferences.length,
        hasMore: product.hasMore.crossReferences,
        content: (
          <CodeGroups
            codes={product.crossReferences}
            locale={locale}
            searchHint={t('crossReferenceSearchHint')}
          />
        )
      })
    }

    if (product.eans.length > 0) {
      list.push({
        id: 'ean',
        title: t('ean'),
        count: product.eans.length,
        hasMore: product.hasMore.eans,
        content: (
          <div className="flex flex-wrap gap-2">
            {product.eans.map((ean) => (
              <span
                key={ean}
                className="rounded-md border border-border bg-card px-2.5 py-1 font-mono text-xs text-foreground"
              >
                {ean}
              </span>
            ))}
          </div>
        )
      })
    }

    if (product.documents.length > 0) {
      list.push({
        id: 'documents',
        title: t('documents'),
        count: product.documents.length,
        hasMore: product.hasMore.documents,
        content: <DocumentsSection documents={product.documents} />
      })
    }

    if (product.images.length > 0) {
      list.push({
        id: 'images',
        title: t('productImages'),
        count: product.images.length,
        hasMore: product.hasMore.images,
        content: <ImagesSection product={product} />
      })
    }

    return list
  }, [product, locale, t])

  const goToSection = useCallback((id: string) => {
    setOpen((prev) => (prev.includes(id) ? prev : [...prev, id]))
    // Accordion açılışı bir render sürdüğü için kaydırmayı bir frame ertele.
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-foreground md:text-xl">
        {t('technicalInfoTitle', {
          brand: product.brand.name,
          partNo: product.partNo
        })}
      </h2>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-8">
        <Accordion
          type="multiple"
          value={open}
          onValueChange={setOpen}
          className="rounded-lg border border-border bg-card px-4"
        >
          {sections.map((s) => (
            <AccordionItem key={s.id} value={s.id} id={s.id} className={SCROLL_MARGIN}>
              <AccordionTrigger className="text-sm font-semibold md:text-base">
                <span className="flex items-baseline gap-2">
                  {s.title}
                  {s.count != null && (
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">
                      {s.count}
                      {s.hasMore ? '+' : ''}
                    </span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>{s.content}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <nav aria-label={t('onThisPage')} className="hidden lg:block">
          <div className="sticky top-24 rounded-lg border border-border bg-card p-2">
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('onThisPage')}
            </p>
            <ul>
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => goToSection(s.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
                      open.includes(s.id)
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/**
 * Trodo'daki "Product details" tablosu: künye alanları (marka, ürün kodu,
 * kategori, barkod) + part_properties satırları, geniş ekranda iki sütun.
 */
function DetailsSection({ product }: { product: CatalogProductDetailView }) {
  const t = useTranslations('ProductDetail')
  const locale = useLocale()

  const categoryLabel = product.categoryPath.length
    ? product.categoryPath
        .map((c) => (locale === 'tr' && c.nameTr ? c.nameTr : c.name))
        .join(' › ')
    : null

  const rows: Array<{ key: string; label: string; value: string }> = []
  if (product.eans.length > 0) {
    rows.push({ key: '_ean', label: t('ean'), value: product.eans[0] })
  }
  for (const p of product.properties) {
    rows.push({ key: p.key, label: p.key, value: p.value })
  }
  rows.push({ key: '_brand', label: t('manufacturer'), value: product.brand.name })
  rows.push({ key: '_partNo', label: t('articleNumber'), value: product.partNo })
  if (categoryLabel) {
    rows.push({ key: '_category', label: t('category'), value: categoryLabel })
  }

  return (
    <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-b-0 md:last:border-b"
        >
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="text-right text-sm font-medium text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Uyumlu araçlar marka → model altında gruplanır. Liste uzun olabildiği için
 * istemci tarafı bir arama kutusu var; sunucudan gelen kayıt sayısı sınırlıdır
 * ve toplam sayı altta belirtilir.
 */
function VehiclesSection({ vehicles }: { vehicles: VehicleFitment[] }) {
  const t = useTranslations('ProductDetail')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    if (!q) return vehicles
    return vehicles.filter((v) => v.label.toLocaleLowerCase('tr').includes(q))
  }, [vehicles, query])

  const groups = useMemo(() => {
    const byBrand = new Map<string, Map<string, VehicleFitment[]>>()
    for (const v of filtered) {
      const brand = v.brand ?? '—'
      const model = v.model ?? '—'
      let models = byBrand.get(brand)
      if (!models) {
        models = new Map()
        byBrand.set(brand, models)
      }
      const list = models.get(model)
      if (list) list.push(v)
      else models.set(model, [v])
    }
    return [...byBrand.entries()]
  }, [filtered])

  return (
    <div>
      <div className="relative mb-3">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('vehicleSearchPlaceholder')}
          className="h-9 pl-8 text-sm"
        />
      </div>

      {groups.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t('noVehicleMatch')}</p>
      ) : (
        <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {groups.map(([brand, models]) => (
            <div key={brand}>
              <h4 className="mb-1.5 text-sm font-semibold text-foreground">{brand}</h4>
              <div className="space-y-2">
                {[...models.entries()].map(([model, types]) => (
                  <div key={model}>
                    <p className="text-xs font-medium text-muted-foreground">{model}</p>
                    <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {types.map((v) => (
                        <li
                          key={v.id}
                          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                        >
                          <span className="text-foreground">{v.name}</span>
                          <span className="ml-1 text-muted-foreground">
                            {formatEngine(v)}
                          </span>
                          {(v.yearFrom || v.yearTo) && (
                            <span className="ml-1 text-muted-foreground">
                              · {v.yearFrom ?? '…'}–{v.yearTo ?? '…'}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatEngine(v: VehicleFitment): string {
  const parts = [
    v.cc ? `${v.cc} cc` : null,
    v.hp ? `${v.hp} HP` : null,
    v.kw ? `${v.kw} kW` : null,
    v.fuelType
  ].filter(Boolean)
  return parts.length ? `(${parts.join(', ')})` : ''
}

/** OE numarası / çapraz referans listesi — üretici markasına göre gruplanır. */
function CodeGroups({
  codes,
  locale,
  searchHint
}: {
  codes: PartCode[]
  locale: string
  searchHint: string
}) {
  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of codes) {
      const brand = c.brand ?? ''
      const list = map.get(brand)
      if (list) list.push(c.code)
      else map.set(brand, [c.code])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'tr'))
  }, [codes])

  return (
    <div>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
        {groups.map(([brand, list]) => (
          <div key={brand || '_'}>
            {brand && (
              <h4 className="mb-1.5 text-sm font-semibold text-foreground">{brand}</h4>
            )}
            <div className="flex flex-wrap gap-1.5">
              {list.map((code) => (
                <Link
                  key={`${brand}-${code}`}
                  href={`/${locale}/search?q=${encodeURIComponent(code)}`}
                  title={searchHint}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {code}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * TecDoc dokümanları (montaj kılavuzu, güvenlik bilgi formu, teknik çizim…)
 * doküman tipine göre gruplanır. Adresi olmayan kayıtlar link'lenmez.
 */
function DocumentsSection({
  documents
}: {
  documents: CatalogProductDetailView['documents']
}) {
  const t = useTranslations('ProductDetail')

  const groups = useMemo(() => {
    const map = new Map<string, typeof documents>()
    for (const d of documents) {
      const key = d.typeName || t('otherDocuments')
      const list = map.get(key)
      if (list) list.push(d)
      else map.set(key, [d])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'tr'))
  }, [documents, t])

  return (
    <div>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
        {groups.map(([type, list]) => (
          <div key={type}>
            <h4 className="mb-1.5 text-sm font-semibold text-foreground">{type}</h4>
            <ul className="space-y-1">
              {list.map((d) => (
                <li key={d.id}>
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <FileText size={13} className="shrink-0" />
                      <span className="break-all">{d.name || d.typeName}</span>
                      <ExternalLink size={11} className="shrink-0" />
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText size={13} className="shrink-0" />
                      <span className="break-all">{d.name || d.typeName}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImagesSection({ product }: { product: CatalogProductDetailView }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {product.images.map((img) => (
          <a
            key={img.url}
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            className="aspect-square overflow-hidden rounded-md border border-border bg-white transition-colors hover:border-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.thumb ?? img.url}
              alt={product.name}
              className="h-full w-full object-contain p-1"
              loading="lazy"
            />
          </a>
        ))}
      </div>
    </div>
  )
}
