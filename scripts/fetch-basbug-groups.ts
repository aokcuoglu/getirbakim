import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

const BASBUG_BASE = process.env.BASBUG_BASE_URL || 'https://api.basbug.com.tr'
const FIRMA_ADI = 'BASBUG'

async function getBasbugToken(): Promise<string> {
  console.log('[basbug] Authenticating...')
  const res = await fetch(`${BASBUG_BASE}/auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kullaniciAdi: process.env.BASBUG_USERNAME,
      parola: process.env.BASBUG_PASSWORD,
      clientID: process.env.BASBUG_CLIENT_ID,
      clientSecret: process.env.BASBUG_CLIENT_SECRET
    })
  })

  if (!res.ok) {
    console.error(`Auth failed: HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data: any = await res.json()
  console.log('[basbug] Auth successful, token received')
  return data.token
}

async function main() {
  const token = await getBasbugToken()

  console.log('\n[basbug] Fetching ListeGrubuGetir...')
  const res = await fetch(
    `${BASBUG_BASE}/material/ListeGrubuGetir?FirmaAdi=${FIRMA_ADI}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
  )

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data: any = await res.json()
  const groups = data.malzemeGruplariListesi || []

  console.log(`\nTotal groups: ${groups.length}`)
  console.log('\nAll groups:')
  groups.forEach((g: any, i: number) => {
    console.log(`  ${i + 1}. kod="${g.kod}" ad="${g.ad}"`)
  })
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})