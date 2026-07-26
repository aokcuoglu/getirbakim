'use client'

import { useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export function SourceBadge({ source }: { source: string }) {
  // MANUAL: admin elle girdi · WEB: onaylanmış web önerisi — ikisi de silinebilir,
  // bu yüzden tedarikçi/TecDoc kaynaklarından görsel olarak ayrılır.
  const editable = source === 'MANUAL' || source === 'WEB'
  return (
    <Badge
      variant="outline"
      className={
        editable
          ? 'border-primary/40 bg-primary/10 text-[10px] font-medium text-primary'
          : 'border-border bg-muted text-[10px] text-muted-foreground'
      }
    >
      {source}
    </Badge>
  )
}

export interface CodeItem {
  code: string
  source: string
  extra?: string | null
}

/**
 * Satır kimliği. `extra` (OEM'de araç markası) dahil: aynı kod, aynı kaynak
 * altında birden çok marka varyantı olarak listelenebilir — key'e girmezse
 * React'te çakışır, silme sırasında da yanlış satır hedeflenir.
 */
const codeKey = (c: CodeItem) => `${c.source}:${c.code}:${c.extra ?? ''}`

/**
 * Kanonik ürünün kimlik havuzunu (OEM/çapraz veya EAN) listeler + manuel
 * ekleme/silme yapar. Sync kaynaklı (DNMK/BSBG/PARTS) satırlar salt-okunur;
 * yalnız MANUAL/WEB kayıtlarda kaldır (X) görünür. Mutasyonlar anında kaydeder.
 *
 * Hem ürün detay sheet'i hem de eşleştirme modalindeki hızlı düzenleme paneli
 * bu bileşeni kullanır.
 */
export function CodeEditor({
  title,
  codes,
  placeholder,
  hint,
  listClassName,
  onAdd,
  onRemove
}: {
  title: string
  codes: CodeItem[]
  placeholder: string
  hint?: string
  /** Liste yüksekliği; modal içinde daha kısa tutulur. */
  listClassName?: string
  onAdd: (code: string) => Promise<boolean>
  onRemove: (item: CodeItem) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const handleAdd = async () => {
    const code = value.trim()
    if (!code || adding) return
    setAdding(true)
    const ok = await onAdd(code)
    setAdding(false)
    if (ok) setValue('')
  }

  const handleRemove = async (item: CodeItem) => {
    setRemoving(codeKey(item))
    await onRemove(item)
    setRemoving(null)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {title}{' '}
        <span className="text-xs font-normal text-muted-foreground">({codes.length})</span>
      </h3>

      {codes.length > 0 && (
        <ul
          className={`space-y-1 overflow-y-auto rounded-md border border-border p-2 ${
            listClassName ?? 'max-h-44'
          }`}
        >
          {codes.map((c) => (
            <li key={codeKey(c)} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-foreground">{c.code}</span>
              {c.extra ? (
                <span className="text-[10px] text-muted-foreground">{c.extra}</span>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                <SourceBadge source={c.source} />
                {c.source === 'MANUAL' || c.source === 'WEB' ? (
                  <button
                    type="button"
                    aria-label="Kaldır"
                    onClick={() => void handleRemove(c)}
                    disabled={removing === codeKey(c)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                  >
                    {removing === codeKey(c) ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleAdd()
            }
          }}
          placeholder={placeholder}
          className="h-8 text-xs"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding || value.trim().length === 0}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Ekle
        </button>
      </div>

      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
