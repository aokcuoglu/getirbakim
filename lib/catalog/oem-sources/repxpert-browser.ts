/**
 * REPXPERT taşıma katmanı — gerçek tarayıcı oturumu.
 *
 * Neden tarayıcı: servisin önünde Akamai bot yönetimi var. Sunucu tarafından
 * atılan düz `fetch` (curl, Bun) doğrudan "Access denied" HTML'i alıyor; geçerli
 * `_abck` çerezi ancak sayfanın kendi sensör betiği çalıştıktan sonra oluşuyor.
 * Bu yüzden istekler sayfanın İÇİNDEN, sitenin kendi origin'inde atılır — bu,
 * kullanıcının tarayıcıda gezinirken ürettiği isteğin aynısıdır.
 *
 * İKİ ÖN KOŞUL ölçülerek bulundu, ikisi de zorunlu:
 *
 *  1. TARAYICI GÖRÜNÜR OLMALI. `headless: true` ile açılan Chromium daha ana
 *     sayfada "Access denied" alıyor (parmak izinden tanınıyor). Bu yüzden
 *     varsayılan headful; headless yalnız denemek için açılabilir.
 *  2. OTURUM GİRİŞLİ OLMALI. Anonim kullanıcıda servis ürün kodunu çözmüyor:
 *     "can not be resolved since TecDoc is disabled in the current context".
 *     Yani OEM verisi üyeliğe bağlı.
 *
 * Oturum kalıcı profilde tutulur (`.data/repxpert/profile`). Kullanıcı
 * `bun scripts/repxpert-login.ts` ile bir kez tarayıcı açıp KENDİ girişini
 * yapar; profil oturumu saklar. Script hiçbir yerde parola tutmaz, sormaz,
 * yazmaz.
 *
 * Hız: istekler arası en az `minIntervalMs` beklenir. Bu, sürücünün
 * `--delay`inden BAĞIMSIZ bir alt sınırdır — eşzamanlılık artsa bile kaynak
 * üzerindeki tempo bu sınırın altına inemez.
 */
import type { BrowserContext, Page } from 'playwright'
import type { RepxpertTransport } from './repxpert'

const ORIGIN = 'https://www.repxpert.com.tr'
const HOME = `${ORIGIN}/tr`
/** Giriş script'iyle scraper aynı profili paylaşır; oturum orada yaşar. */
export const REPXPERT_PROFILE_DIR = '.data/repxpert/profile'
const QUERY = 'lang=tr&curr=RXP&catalogCountry=TR'
/** Spartacus'un localStorage anahtarı; ayraç U+26BF (⚿) — birebir olmalı. */
const TOKEN_KEY = 'spartacus⚿⚿auth'
/** Akamai engeli JSON değil HTML döner; sessizce "sonuç yok" sayılmamalı. */
const BLOCK_MARKER = 'Access denied'

export class RepxpertBlockedError extends Error {
  constructor() {
    super(
      'REPXPERT isteği bot korumasına takıldı (Access denied). Koşuyu durdurun; ' +
        'hızı düşürün ve profil oturumunun geçerli olduğunu doğrulayın.'
    )
    this.name = 'RepxpertBlockedError'
  }
}

export class RepxpertAuthError extends Error {
  constructor(status: number) {
    super(
      `REPXPERT oturumu girişli değil (${status}). Servis anonim bağlamda TecDoc'u ` +
        'kapatıyor, bu yüzden koşu başlatılmadı. `bun scripts/repxpert-login.ts` ' +
        'çalıştırıp açılan pencerede giriş yapın; oturum profile kaydedilir.'
    )
    this.name = 'RepxpertAuthError'
  }
}

export interface RepxpertBrowserOptions {
  /** Kalıcı Chrome profili — oturum burada saklanır. */
  userDataDir?: string
  /** Varsayılan FALSE: headless Chromium bot korumasına takılıyor. */
  headless?: boolean
  /** İstekler arası alt sınır (ms). Varsayılan 1000 = ~1 istek/sn. */
  minIntervalMs?: number
  timeoutMs?: number
}

export interface RepxpertBrowserTransport extends RepxpertTransport {
  /** Koşunun hangi hesapla gittiği. */
  describeSession(): string
  close(): Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function createRepxpertBrowserTransport(
  options: RepxpertBrowserOptions = {}
): Promise<RepxpertBrowserTransport> {
  const {
    userDataDir = REPXPERT_PROFILE_DIR,
    headless = false,
    minIntervalMs = 1000,
    timeoutMs = 30_000
  } = options

  // Playwright yalnız bu taşımanın bağımlılığı; scraper'ın geri kalanı ve
  // uygulama onu import etmesin diye yükleme ertelenir.
  const { chromium } = await import('playwright')

  // launch() atar; TS akışı fonksiyon üzerinden göremediği için kesin atama.
  let context!: BrowserContext
  let page!: Page

  async function launch(): Promise<void> {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1440, height: 900 },
      locale: 'tr-TR'
    })
    page = context.pages()[0] ?? (await context.newPage())

    // Sensör betiğinin çalışıp çerezleri kurması için siteyi bir kez aç.
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    if ((await page.title()).includes(BLOCK_MARKER)) {
      await context.close()
      throw new RepxpertBlockedError()
    }
    await page.waitForFunction((key) => localStorage.getItem(key) !== null, TOKEN_KEY, {
      timeout: timeoutMs
    })
  }

  await launch()

  let nextAllowedAt = 0

  async function pace(): Promise<void> {
    const wait = nextAllowedAt - Date.now()
    if (wait > 0) await sleep(wait)
    nextAllowedAt = Date.now() + minIntervalMs
  }

  /**
   * Tarayıcı gitti mi. Günlerce süren koşuda pencerenin kapanması (uyku, elle
   * kapatma, çökme) gerçek bir olay; ayırt edilmezse KALAN BÜTÜN ÜRÜNLER
   * ardı ardına hata verir ve koşu sessizce boşa döner.
   */
  function isBrowserGone(error: unknown): boolean {
    const message = (error as Error)?.message ?? ''
    return (
      message.includes('has been closed') ||
      message.includes('Target closed') ||
      message.includes('Target page, context or browser has been closed') ||
      message.includes('browser has disconnected')
    )
  }

  async function evaluateFetch(path: string): Promise<{ status: number; text: string }> {
    return page.evaluate(
      async ([target, key]) => {
        const raw = localStorage.getItem(key as string)
        const token = raw ? JSON.parse(raw)?.token?.access_token : null
        const res = await fetch(target as string, {
          headers: {
            accept: 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {})
          }
        })
        return { status: res.status, text: await res.text() }
      },
      [path, TOKEN_KEY] as const
    )
  }

  /** Sayfanın içinden tek istek. Yetki durumunu YORUMLAMAZ, olduğu gibi döner. */
  async function rawGet(path: string): Promise<{ status: number; body: unknown }> {
    await pace()

    let result: { status: number; text: string }
    try {
      result = await evaluateFetch(path)
    } catch (error) {
      if (!isBrowserGone(error)) throw error
      // Pencere kapanmış: profili yeniden aç ve isteği BİR kez tekrarla.
      // Oturum profilde olduğu için yeniden giriş gerekmez.
      console.warn('[repxpert] tarayıcı kapanmış, oturum yeniden açılıyor')
      await context.close().catch(() => {})
      await launch()
      result = await evaluateFetch(path)
    }

    if (result.text.includes(BLOCK_MARKER)) throw new RepxpertBlockedError()
    // 400 "ürün yok" yanıtı gövdesizdir; JSON.parse'a sokulmamalı.
    let body: unknown = null
    if (result.text.trim().length > 0) {
      try {
        body = JSON.parse(result.text)
      } catch {
        body = null
      }
    }
    return { status: result.status, body }
  }

  // Girişsiz koşmanın anlamı yok: servis anonim bağlamda TecDoc'u kapatıyor,
  // her ürün "sonuç yok" döner ve checkpoint binlerce ürünü boşuna "denendi"
  // diye işaretlerdi. Bu yüzden en baştan durulur.
  const session = await rawGet(`/api/Repxpert-TR/users/current?fields=uid&${QUERY}`)
  if (session.status !== 200) {
    await context.close()
    throw new RepxpertAuthError(session.status)
  }
  const uid = (session.body as { uid?: string } | null)?.uid ?? 'kullanıcı'

  return {
    async get(path: string) {
      const res = await rawGet(path)
      // Yetkisizlik tek bir üründe değil, koşunun tamamında geçerlidir:
      // sonuçsuz sorgu gibi yutulursa binlerce ürün boşuna "denendi" işaretlenir.
      if (res.status === 401 || res.status === 403) throw new RepxpertAuthError(res.status)
      return res
    },

    /** Koşu günlüğüne hangi hesapla gidildiğini yazmak için. */
    describeSession() {
      return `girişli (${uid})`
    },

    async close() {
      await context.close()
    }
  }
}
