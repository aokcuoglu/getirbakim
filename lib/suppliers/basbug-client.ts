import 'server-only'

import { basbugFetch, getBasbugToken } from '@/lib/basbug'

const FIRMA_ADI = 'BASBUG'

export interface BasbugListeGrubu {
  kod: string
  ad: string
}

export interface BasbugMalzeme {
  no: string
  ac: string
  ac2: string
  mkk: string
  oe: string
  uk: string
  lgk: string
  m: string
  mo: string
  y: string
  b: string
  dc: string
  lf: number
}

export interface BasbugDovizKuru {
  alis: string
  satis: string
  dovizCinsi: string
}

interface BasbugListeGrubuResponse {
  malzemeGruplariListesi: BasbugListeGrubu[]
}

interface BasbugDovizResponse {
  dovizListesi: BasbugDovizKuru[]
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length ? text : null
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function getListeGruplari(): Promise<BasbugListeGrubu[]> {
  const data = await basbugFetch<BasbugListeGrubuResponse>(
    `/material/ListeGrubuGetir?FirmaAdi=${FIRMA_ADI}`
  )

  const groups = data.malzemeGruplariListesi
  if (!Array.isArray(groups)) {
    throw new Error('Başbuğ ListeGrubuGetir: malzemeGruplariListesi array değil.')
  }

  return groups
    .map((g) => ({
      kod: normalizeText(g.kod) || '',
      ad: normalizeText(g.ad) || ''
    }))
    .filter((g) => g.kod.length > 0)
}

interface BasbugMalzemeResponse {
  malzemeListesi: BasbugMalzeme[]
}

export async function getMalzemeler(
  listeGrubu: string
): Promise<BasbugMalzeme[]> {
  const data = await basbugFetch<BasbugMalzemeResponse>(
    `/material/MalzemeleriGetir?FirmaAdi=${FIRMA_ADI}&ListeGrubu=${encodeURIComponent(listeGrubu)}`
  )

  const list = data.malzemeListesi
  if (!Array.isArray(list)) {
    throw new Error(
      `Başbuğ MalzemeleriGetir (${listeGrubu}): malzemeListesi array değil.`
    )
  }

  return list
    .map((item): BasbugMalzeme | null => {
      if (!isRecord(item)) return null
      const raw = item as unknown as Record<string, unknown>
      const no = normalizeText(raw.no)
      if (!no) return null

      return {
        no,
        ac: normalizeText(raw.ac) || '',
        ac2: normalizeText(raw.ac2) || '',
        mkk: normalizeText(raw.mkk) || '',
        oe: normalizeText(raw.oe) || '',
        uk: normalizeText(raw.uk) || '',
        lgk: normalizeText(raw.lgk) || listeGrubu,
        m: normalizeText(raw.m) || '',
        mo: normalizeText(raw.mo) || '',
        y: normalizeText(raw.y) || '',
        b: normalizeText(raw.b) || '',
        dc: normalizeText(raw.dc) || 'TL',
        lf: normalizeNumber(raw.lf) ?? 0
      }
    })
    .filter((item): item is BasbugMalzeme => item !== null)
}

export async function getDovizBilgisi(): Promise<BasbugDovizKuru[]> {
  const data = await basbugFetch<BasbugDovizResponse>(
    `/material/DovizBilgisiGetir?FirmaAdi=${FIRMA_ADI}`
  )

  const list = data.dovizListesi
  if (!Array.isArray(list)) {
    throw new Error('Başbuğ DovizBilgisiGetir: dovizListesi array değil.')
  }

  return list
    .map((item) => ({
      alis: normalizeText(item.alis) || '0',
      satis: normalizeText(item.satis) || '0',
      dovizCinsi: normalizeText(item.dovizCinsi) || ''
    }))
    .filter((item) => item.dovizCinsi.length > 0)
}

export async function getMalzemeDetay(
  malzemeNo: string
): Promise<Record<string, unknown> | null> {
  try {
    const data = await basbugFetch<Record<string, unknown>>(
      `/material/MalzemeAra?FirmaAdi=${FIRMA_ADI}&MalzemeNo=${encodeURIComponent(malzemeNo)}`
    )
    return isRecord(data) ? data : null
  } catch {
    return null
  }
}
