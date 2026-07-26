/**
 * Web aramalı model kaynağı — bir markanın resmi kataloğu olmadığında son çare.
 *
 * Neden gerekli: katalogdaki OEM'siz ürünlerin büyük çoğunluğu (KRAFTVOLL,
 * ORIJINAL, WENDERPARTS, PROA, VORTEX, ABA…) hiçbir açık üretici kataloğunda
 * yok. Bu markalar için kalan tek kaynak, kodu web'de arayıp sonucu okumak.
 *
 * Nasıl çalışır: Claude'a web arama aracı verilir, modelden aramayı yapıp
 * bulduğu OEM'leri `report_oems` aracıyla YAPISAL olarak bildirmesi istenir.
 * Serbest metin değil, şemalı çıktı — böylece hem ayrıştırma belirsizliği hem
 * de "cevabı anlatan ama kaynak vermeyen" yanıt biçimi ortadan kalkar.
 *
 * Uydurmaya karşı üç kat savunma:
 *   1. Her OEM satırı için kaynak URL ZORUNLU (şema gereği).
 *   2. URL'si olmayan ya da http ile başlamayan satırlar atılır.
 *   3. Sonuç kanonik tabloya değil, insan onayı bekleyen kuyruğa yazılır;
 *      güven düzeyi kaynak sayısına göre verilir, hiçbiri HIGH değildir —
 *      model doğru olabilir ama üretici kataloğu kadar güvenilir değildir.
 *
 * Maliyet: her ürün ayrı bir model çağrısı + web araması demektir. Bu kaynak
 * tüm katalogu taramak için DEĞİL, hedefli kullanım içindir (bkz. sürücü
 * scriptteki --limit / marka seçimi ve koşu sonundaki maliyet özeti).
 */
import Anthropic from '@anthropic-ai/sdk'
import { normalizeOem } from '../../matching/code-normalization'
import type { OemLookup, OemSource, SourcedOem } from './types'

const SITE = 'llm-web-search'

/** Bir üründe kaç arama turuna izin verildiği — maliyetin ana kaldıracı. */
const MAX_SEARCHES = 4
/** Model çıktısı için tavan; düşünme payı dahil. */
const MAX_TOKENS = 8000
/** pause_turn (sunucu aracı tur sınırı) için devam denemesi sayısı. */
const MAX_CONTINUATIONS = 3

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_oems',
  description:
    'Report the OEM (original equipment manufacturer) cross-reference numbers you found for the requested aftermarket part. Call this exactly once, after searching. If you found nothing you can verify, call it with found=false and an empty list.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      found: {
        type: 'boolean',
        description: 'True only if at least one OEM number was found on a real source page.'
      },
      oems: {
        type: 'array',
        description: 'One entry per OEM number. Empty when found=false.',
        items: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The OEM number exactly as printed on the source page.'
            },
            vehicleMake: {
              type: 'string',
              description:
                'Vehicle manufacturer this OEM number belongs to (e.g. "Volkswagen", "Fiat"). Empty string if the source does not say.'
            },
            sourceUrl: {
              type: 'string',
              description:
                'URL of the page where you saw this exact number. Must be a page you actually retrieved.'
            }
          },
          required: ['code', 'vehicleMake', 'sourceUrl'],
          additionalProperties: false
        }
      },
      partDescription: {
        type: 'string',
        description: 'Short description of the part if the sources state it, else empty string.'
      }
    },
    required: ['found', 'oems', 'partDescription'],
    additionalProperties: false
  }
}

const SYSTEM_PROMPT = `You look up OEM cross-reference numbers for automotive aftermarket parts.

Rules:
- Search the web before answering. Never answer from memory alone.
- Report a number ONLY if you saw it on a page you retrieved, listed as an OEM / original / orijinal reference for this exact part number of this exact brand.
- The part's own number is not an OEM number. Do not report it.
- A number listed for a *similar* part, or for the same part from a different brand, does not count. If the page does not clearly tie the OEM number to the requested brand + part number, leave it out.
- Turkish supplier sites often label these "OEM No", "Orijinal No", "OE Kodu", or "Muadil". Cross-reference numbers of other aftermarket brands (FEBI, BOSCH…) are NOT OEM numbers.
- Reporting nothing is a correct and useful answer. Do not guess, do not pattern-match a plausible-looking number, and do not infer a number from the part number itself.
- Call report_oems exactly once when done.`

function buildPrompt(brand: string, partNo: string, productName: string): string {
  return [
    `Find the OEM cross-reference numbers for this aftermarket part:`,
    ``,
    `Brand: ${brand}`,
    `Part number: ${partNo}`,
    productName && productName.trim() !== `${brand} ${partNo}`
      ? `Listed as: ${productName}`
      : null,
    ``,
    `Search for the brand and part number together. Then call report_oems.`
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export interface LlmWebUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  webSearches: number
}

export interface LlmWebOptions {
  client?: Anthropic
  model?: string
  /** Düşünme derinliği: basit bir çıkarma işi olduğu için varsayılan düşük. */
  effort?: 'low' | 'medium' | 'high'
  maxSearches?: number
}

export interface LlmWebSource extends OemSource {
  usage(): LlmWebUsage
}

/**
 * Model yanıtından `report_oems` çağrısını çıkarır.
 * Yanıtta çağrı yoksa (model yalnız metin yazdıysa) null döner — uydurma
 * metni ayrıştırmaya çalışmaktansa sonucu yok saymak doğru davranış.
 */
export function extractReport(
  content: Anthropic.ContentBlock[]
): { found: boolean; oems: { code: string; vehicleMake: string; sourceUrl: string }[]; partDescription: string } | null {
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === REPORT_TOOL.name) {
      const input = block.input as Record<string, unknown>
      const rawOems = Array.isArray(input.oems) ? input.oems : []
      return {
        found: input.found === true,
        oems: rawOems.flatMap((entry) => {
          const o = entry as Record<string, unknown>
          if (typeof o?.code !== 'string' || typeof o?.sourceUrl !== 'string') return []
          return [
            {
              code: o.code,
              vehicleMake: typeof o.vehicleMake === 'string' ? o.vehicleMake : '',
              sourceUrl: o.sourceUrl
            }
          ]
        }),
        partDescription: typeof input.partDescription === 'string' ? input.partDescription : ''
      }
    }
  }
  return null
}

/** Kaynağı doğrulanamayan satırları eler. */
export function keepVerifiable(
  oems: { code: string; vehicleMake: string; sourceUrl: string }[],
  partNo: string
): SourcedOem[] {
  const partNoNorm = normalizeOem(partNo)
  const seen = new Set<string>()
  const out: SourcedOem[] = []

  for (const oem of oems) {
    // Kaynaksız satır = doğrulanamaz iddia; modelin ne kadar emin olduğu önemsiz.
    if (!/^https?:\/\//i.test(oem.sourceUrl.trim())) continue
    const codeNorm = normalizeOem(oem.code)
    if (!codeNorm || codeNorm.length < 5 || !/\d/.test(codeNorm)) continue
    if (codeNorm === partNoNorm) continue
    if (seen.has(codeNorm)) continue
    seen.add(codeNorm)
    out.push({ brand: oem.vehicleMake.trim() || null, code: oem.code.trim() })
  }
  return out
}

export function createLlmWebSource(options: LlmWebOptions = {}): LlmWebSource {
  const client = options.client ?? new Anthropic()
  const model = options.model ?? 'claude-opus-5'
  const effort = options.effort ?? 'low'
  const maxSearches = options.maxSearches ?? MAX_SEARCHES

  const totals: LlmWebUsage = { requests: 0, inputTokens: 0, outputTokens: 0, webSearches: 0 }

  return {
    site: SITE,
    // Web'den çıkarım — doğru olabilir ama kanıtlanmış değil.
    authoritative: false,
    // Kapsayıcı kaynak: kendi kataloğu olmayan her marka buraya düşer.
    supports: () => true,
    brands: () => [],
    usage: () => ({ ...totals }),

    async lookup(brand: string, partNo: string, productName = ''): Promise<OemLookup> {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: buildPrompt(brand, partNo, productName) }
      ]

      let response: Anthropic.Message | null = null
      for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
        response = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          output_config: { effort },
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches },
            REPORT_TOOL
          ],
          messages
        })

        totals.requests++
        totals.inputTokens += response.usage.input_tokens
        totals.outputTokens += response.usage.output_tokens
        totals.webSearches += response.usage.server_tool_use?.web_search_requests ?? 0

        // Sunucu aracı tur sınırına takıldı: aynı isteği devam ettir.
        if (response.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content })
          continue
        }
        break
      }

      const empty: OemLookup = {
        matched: false,
        oems: [],
        description: null,
        sourceUrl: ''
      }
      if (!response) return empty

      // Güvenlik sınıflandırıcısı reddettiyse içerik boş/kısmi olur.
      if (response.stop_reason === 'refusal') return empty

      const report = extractReport(response.content)
      if (!report || !report.found) return empty

      const oems = keepVerifiable(report.oems, partNo)
      if (oems.length === 0) return empty

      // Kanıt adresi: ilk doğrulanabilir kaynak sayfası.
      const firstUrl =
        report.oems.find((o) => /^https?:\/\//i.test(o.sourceUrl))?.sourceUrl ?? ''

      return {
        matched: true,
        oems,
        description: report.partDescription.trim() || null,
        sourceUrl: firstUrl
      }
    }
  }
}
