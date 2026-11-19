import assert from "node:assert/strict";
import test from "node:test";
import { scramVerifier, validPassword, validVerifier } from "./aws/scram-verifier.mjs";

// Verifier PostgreSQL 18 stored for `CREATE ROLE vec PASSWORD 'pencil-pencil-pencil'`.
const POSTGRES =
  "SCRAM-SHA-256$4096:mn8WySKccY1kSlKVG53R5g==$dF21x1rhC0QuWqMahdwQ7QRQjNbSOyjYvmGZUFSsCZs=:UkXtdPEgUP0wWmB1atCJsCiOagPrPnyrjwSdLZRa1/U=";

test("the verifier matches the one PostgreSQL computes for the same password and salt", () => {
  const salt = Buffer.from("mn8WySKccY1kSlKVG53R5g==", "base64");
  assert.equal(scramVerifier("pencil-pencil-pencil", salt), POSTGRES);
});

test("each verifier gets a fresh salt and never contains the password", () => {
  const first = scramVerifier("pencil-pencil-pencil");
  const second = scramVerifier("pencil-pencil-pencil");
  assert.notEqual(first, second);
  assert.ok(validVerifier(first));
  assert.ok(!first.includes("pencil"));
});

test("short, spaced or non-ASCII passwords and malformed verifiers are refused", () => {
  assert.ok(!validPassword("short"));
  assert.ok(!validPassword("has spaces in the middle"));
  assert.ok(!validPassword("şifreşifreşifreşifre"));
  assert.throws(() => scramVerifier("short"));
  assert.ok(!validVerifier(""));
  assert.ok(!validVerifier("md5abcdef"));
});
