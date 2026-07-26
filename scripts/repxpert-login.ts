/**
 * REPXPERT oturumunu scraper'ın kullandığı kalıcı profile bir kez kaydeder.
 *
 * Neden gerekli: servis anonim bağlamda TecDoc'u kapatıyor
 * ("TecDoc is disabled in the current context"), yani OEM verisi üyeliğe bağlı.
 *
 * Bu script YALNIZCA tarayıcıyı açar ve girişi bekler. Parolayı sormaz,
 * okumaz, saklamaz, hiçbir alana yazmaz — girişi kullanıcı kendi eliyle yapar.
 * Oturum çerezi profil klasöründe kalır; scraper aynı profili açtığı için
 * bir daha giriş gerekmez (oturum düşene kadar).
 *
 * Kullanım:
 *   bun scripts/repxpert-login.ts
 */
import { REPXPERT_PROFILE_DIR } from '../lib/catalog/oem-sources/repxpert-browser'

const ORIGIN = 'https://www.repxpert.com.tr'
const QUERY = 'lang=tr&curr=RXP&catalogCountry=TR'
/** Girişin tamamlanması için tanınan süre. */
const WAIT_MS = 10 * 60 * 1000
const POLL_MS = 3000

async function main() {
  const { chromium } = await import('playwright')
  // Headless Chromium bot korumasına takılıyor; pencere görünür açılmalı.
  const context = await chromium.launchPersistentContext(REPXPERT_PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: 'tr-TR'
  })
  const page = context.pages()[0] ?? (await context.newPage())
  // Giriş sayfası dil önekli değil — /tr/login çalışmıyor.
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' })

  console.log('[repxpert-login] Açılan pencerede REPXPERT hesabınızla giriş yapın.')
  console.log('[repxpert-login] Giriş algılanınca pencere kendiliğinden kapanacak.')

  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    // Girişin tek güvenilir kanıtı servisin kendisi: sayfadaki isim/menü
    // görünümü tema ve dile göre değişiyor, users/current değişmiyor.
    const uid = await page
      .evaluate(async (query) => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('auth'))
        const raw = key ? localStorage.getItem(key) : null
        const token = raw ? JSON.parse(raw)?.token?.access_token : null
        if (!token) return null
        const res = await fetch(`/api/Repxpert-TR/users/current?fields=uid&${query}`, {
          headers: { accept: 'application/json', authorization: `Bearer ${token}` }
        })
        if (res.status !== 200) return null
        return ((await res.json()) as { uid?: string })?.uid ?? 'kullanıcı'
      }, QUERY)
      .catch(() => null)

    if (uid) {
      console.log(`[repxpert-login] Giriş tamam: ${uid}`)
      console.log(`[repxpert-login] Oturum ${REPXPERT_PROFILE_DIR} altında saklandı.`)
      console.log('[repxpert-login] Sıradaki: bun scripts/scrape-product-oems.ts --repxpert --brand=VALEO --limit=200')
      await context.close()
      return
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }

  console.error('[repxpert-login] Süre doldu, giriş algılanmadı.')
  await context.close()
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
