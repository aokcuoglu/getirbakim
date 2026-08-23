/**
 * NAME+OEM onay scripti `approve-ref-suggestions.ts` oldu.
 * Bu dosya eski komutu kırılmasın diye oraya yönlendirir.
 */
import { spawn } from 'node:child_process'

const child = spawn(
  process.execPath,
  ['scripts/approve-ref-suggestions.ts', ...process.argv.slice(2)],
  { stdio: 'inherit' }
)
child.on('exit', (code) => process.exit(code ?? 1))
