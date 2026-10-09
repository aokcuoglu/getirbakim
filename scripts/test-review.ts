import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSearchParams } from "../src/lib/search-params";
import { parseCatalogQuery } from "../src/modules/store/catalog-query";
import { createServiceSchema, loginSchema, serviceApplicationSchema } from "../src/modules/auth/schemas";

test("repeated URL keys use the first value, and invalid filters never reach catalog queries", () => {
  assert.deepEqual(normalizeSearchParams({ q: ["first", "second"], brand: [], page: "2" }), { q: "first", brand: undefined, page: "2" });
  const query = parseCatalogQuery({ q: ["  first  ", "second"], category: "Fren/../x", sort: "invalid", page: "Infinity", searchBy: "code" });
  assert.equal(query.q, "first");
  assert.equal(query.searchBy, "code");
  for (const key of ["category", "sort", "page"] as const) assert.equal(query[key], undefined);
  assert.equal(parseCatalogQuery({ q: "x".repeat(121), brand: "x".repeat(201), page: "9007199254740993" }).q, undefined);
});

test("admin creation, application and login reject bcrypt truncation with multibyte passwords", () => {
  const account = { name: "Test servis", email: "TEST@example.invalid", discount: 0 };
  const application = { ...account, contactName: "Yetkili", city: "İstanbul", phone: "05550000000", terms: "on", website: "" };
  for (const password of ["ş".repeat(36) + "suffix", "😀".repeat(19), "a".repeat(73)]) {
    assert.equal(createServiceSchema.safeParse({ ...account, password }).success, false);
    assert.equal(serviceApplicationSchema.safeParse({ ...application, password }).success, false);
    assert.equal(loginSchema.safeParse({ email: account.email, password }).success, false);
  }
  assert.equal(createServiceSchema.safeParse({ ...account, password: "ş".repeat(36) }).success, true);
  assert.equal(createServiceSchema.safeParse({ ...account, password: "too-short" }).success, false);
  assert.equal(createServiceSchema.parse({ ...account, password: "valid-password-12" }).email, "test@example.invalid");
});
