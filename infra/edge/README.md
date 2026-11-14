# Edge nginx (Contabo VPS) — yedek ve bakım modu

Contabo VPS'te 80/443'ü tutan ortak `edge-nginx` konteynerinin yapılandırması. getirbakim.com ve bakimx.com bu konteynerden geçer. Gerçek kopya VPS'te `/opt/edge`. Bu klasör onun yedeği; daha önce kullanılan `aokcuoglu/edge` reposu artık yok.

AWS geçişinden sonra getirbakim.com CloudFront'a gider ve bu yapılandırma yalnız geri dönüş için kalır.

| Dosya | VPS'teki yeri | Not |
| --- | --- | --- |
| `docker-compose.yml`, `deploy.sh`, `README.edge.md` | `/opt/edge/` | Edge biriminin orijinal dosyaları (12 Kasım 2026) |
| `conf.d/getirbakim.conf` | `/opt/edge/conf.d/getirbakim.conf` | VPS'teki hâl + bakım modu bloğu |
| `maintenance/index.html` | `/var/www/certbot/getirbakim-maintenance/index.html` | Bakım sayfası |
| `maintenance/getirbakim-maintenance.sh` | `/opt/edge/getirbakim-maintenance.sh` | Aç / kapat / durum |
| `maintenance/install.sh` | — | Mac'ten kurulum betiği |

`conf.d/bakimx.conf` bakimx projesine ait; bu repoya alınmadı. Sertifikalar host'ta (`/etc/letsencrypt`).

## Bakım modu

Bayrak dosyası `/var/www/certbot/getirbakim-maintenance/on` varsa getirbakim.com'daki her istek bakım sayfasını `503` ile döner (`Retry-After: 3600`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`). nginx her istekte dosyaya bakar; açıp kapatmak için reload gerekmez. www yönlendirmesi ve ACME (port 80) çalışmaya devam eder. bakimx etkilenmez.

Sayfa, edge konteynerine zaten bağlı olan `/var/www/certbot` altında durur. Böylece ortak konteyneri yeniden yaratmak (bakimx'i de keser) gerekmez.

VPS'te:

```bash
bash /opt/edge/getirbakim-maintenance.sh on      # bakım sayfası + getirbakim zamanlayıcıları durur
bash /opt/edge/getirbakim-maintenance.sh status  # bayrak, zamanlayıcılar, sitenin döndürdüğü kod
bash /opt/edge/getirbakim-maintenance.sh off     # site ve zamanlayıcılar geri
```

`on`, `getirbakim-production-sync.timer` ve `getirbakim-production-backup.timer`'ı durdurur ve çalışan bir tedarikçi senkronizasyonu varsa bitmesini bekler. Uygulama konteyneri çalışmaya devam eder; dışarıdan istek almaz.

## Kurulum

Mac'te, repo kökünden:

```bash
bash infra/edge/maintenance/install.sh
```

Betik VPS'teki config'in yedeğini alır (`conf.d/getirbakim.conf.bak.pre-maintenance.<zaman>`), sayfayı ve betiği yerleştirir, config'i aynı dosyanın üzerine yazar (tek dosyalık bind mount aynı inode'u görmeye devam eder), `nginx -t` başarısızsa eski config'i geri koyar, başarılıysa `nginx -s reload` yapar. Bakım modunu açmaz.

## Değişiklik akışı

VPS'te `/opt/edge` yerel bir Git deposu (remote yok). Değişikliği önce burada yapın, sonra VPS'e kopyalayıp `nginx -t` + `nginx -s reload` ile uygulayın. VPS'te elle değişiklik yapılırsa buraya geri alın.

Test (12 Kasım 2026, yerelde `nginx:1.30.3-alpine`, sahte sertifika ve uygulama): bayrak kapalıyken tüm yollar uygulamaya gitti; açıkken `/`, `/katalog`, `/_next/static/*`, `/api/search`, `/api/product-media/*` bakım sayfasını `503` ile döndü; bayrak silinince `200`.
