// Turns a password on stdin into a PostgreSQL SCRAM-SHA-256 verifier (RFC 5802 / RFC 7677),
// so `ALTER ROLE ... PASSWORD '<verifier>'` never sends the plaintext to the server (#940).
// Usage: security find-generic-password -s getirbakim-prod-readonly -w | node scripts/aws/scram-verifier.mjs
//        node scripts/aws/scram-verifier.mjs --check   prints true/false for $GETIRBAKIM_RO_VERIFIER
//        (used by readonly-role.sql, which cannot test a psql variable for emptiness itself)
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const ITERATIONS = 4096;

// Printable ASCII without spaces only: SASLprep leaves these unchanged, so no normalization is needed.
export function validPassword(password) {
  return /^[\x21-\x7e]{16,}$/.test(password);
}

const VERIFIER = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

export function validVerifier(value) {
  return VERIFIER.test(value);
}

export function scramVerifier(password, salt = randomBytes(16), iterations = ITERATIONS) {
  if (!validPassword(password)) throw new Error("password must be at least 16 printable ASCII characters without spaces");
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

async function main() {
  if (process.argv[2] === "--check") {
    process.stdout.write(validVerifier(process.env.GETIRBAKIM_RO_VERIFIER ?? "") ? "true" : "false");
    return;
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const password = input.replace(/\r?\n$/, "");
  if (!validPassword(password)) {
    process.stderr.write("ERR: expected a password of at least 16 printable ASCII characters (no spaces) on stdin\n");
    process.exit(1);
  }
  process.stdout.write(scramVerifier(password));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
