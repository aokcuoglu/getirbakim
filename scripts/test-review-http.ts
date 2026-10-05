import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.VERIFY_URL || "http://localhost:3000";
test("public pages handle repeated query keys without server errors", async () => {
  for (const path of ["/katalog?q=a&q=b", "/katalog?brand=a&brand=b&sort=invalid", "/garaj?make=Fiat&make=Ford", "/giris?error=1&error=limit"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(!html.includes("Şu anda bu alanı açamıyoruz"), path);
    assert.ok(!html.includes("is not a function"), path);
  }
});

test("malformed UUID routes render not-found rather than PostgreSQL errors", async () => {
  for (const route of ["urun", "siparis"]) {
    const response = await fetch(`${base}/${route}/${"-".repeat(36)}`);
    // Next.js can return 200 once a streamed shell has started; the route must render its 404 UI.
    assert.ok([200, 404].includes(response.status), `${route}: ${response.status}`);
    const html = await response.text();
    assert.ok(html.includes("Ürün bulunamadı."), route);
    assert.ok(!html.includes("invalid input syntax"), route);
    assert.ok(!html.includes("Şu anda bu alanı açamıyoruz"), route);
  }
});

 test("catalog sort control and hidden field follow each requested URL", async () => {
  for (const [sort, label] of [["newest", "Son eklenenler"], ["price-asc", "Fiyat: düşükten yükseğe"], ["price-desc", "Fiyat: yüksekten düşüğe"]]) {
    const response = await fetch(`${base}/katalog?sort=${sort}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`name="sort" value="${sort}"`));
    assert.ok(html.includes(`<span>${label}</span>`));
  }
});
