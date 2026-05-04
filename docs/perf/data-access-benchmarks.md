# Data Access Benchmarks (Prisma-First Hybrid)

Bu dosya, ORM/SQL secimlerinde performans kanitini merkezi tutmak icin kullanilir.

## Benchmark Yontemi
- Ortam: production-benzeri DB boyutu + index seti.
- Olcum:
  - `EXPLAIN (ANALYZE, BUFFERS)` ciktilari
  - Endpoint p95 (once/sonra)
- Karar:
  - ORM varyanti SQL ile <= %10 farkta ise ORM tercih edilir.
  - ORM varyanti > %20 yavas ise SQL korunur.

## Kayit Tablosu

| Sorgu/Alan | ORM Durumu | SQL Durumu | Karar | Gerekce |
|---|---|---|---|---|
| `getPopularPartIds` | Test edildi | Eski SQL vardi | ORM | Basit aggregation ORM ile okunabilir ve yeterli hizda. |
| `admin-products` paged rows/metrics/total | Kismi/karma | Test edildi | SQL | Computed column + ranked exact/prefix/fuzzy arama + tek sorguda aggregate ihtiyaci. |
| `getDinamikBrandMappings` | Zor | Test edildi | SQL | `LATERAL` + latest-alias semantics ORM’de tek sorguda ifade edilemiyor. |

## Notlar
- Bu dosya her performans odakli refactor’da guncellenmelidir.
- SQL’de kalan her sorgunun kodda kisa gerekce yorumu bulunmalidir.
- 2026-03-08: Admin Products Workbench v1 icin ranked search ve browser-read API eklendi. Bu workspace'te production-benzeri DB uzerinde `EXPLAIN (ANALYZE, BUFFERS)` / p95 olcumu calistirilamadi; deploy oncesi hedef ortamda tekrar alinmali.
