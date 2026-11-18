# Tedarikçi çıkış proxy'si (Contabo VPS)

Dinamik API'si IP allow-list'iyle çalışır. Proxy, Dinamik yalnız VPS adresine (173.249.36.2) izin verirken AWS'ten çağrı yapabilmek için kuruldu (#411). Başbuğ'da IP kısıtı yok (9 Kasım 2026); yalnız kullanıcı adı/parola ile çalışır ve proxy'den geçmez.

**16 Kasım 2026:** Dinamik AWS çıkış IP'sini (18.194.217.212) de allow-list'e ekledi; AWS'ten proxy'siz doğrudan çağrı doğrulandı (`getBrandList` 800 marka, #802). Proxy artık zorunlu değil: AWS'te `SUPPLIER_EGRESS_PROXY` kaldırılınca çağrılar doğrudan çıkar. Squid, Dinamik izni kalkarsa diye yedek olarak kalabilir; tamamen kapatmak için [Kaldırma](#kaldırma).

Proxy yalnız HTTP CONNECT tüneli açar. TLS uygulama ile tedarikçi arasında uçtan uca kurulur; proxy API anahtarlarını ve veriyi görmez, yalnız hedef `host:443` bilgisini görür. TAMI ödeme çağrıları proxy'den geçmez.

## Erişim kapıları

Bir isteğin geçmesi için dört koşulun hepsi gerekir:

| Kapı | Nerede | Aksi halde |
| --- | --- | --- |
| İstemci AWS çıkış IP'si | ufw + `allowed-clients.txt` | bağlantı reddi / 403 |
| İstek yalnız `CONNECT` ve port 443 | `squid.conf` | 403 |
| Hedef izinli tedarikçi host'u | `allowed-hosts.txt` | 403 |
| Doğru kullanıcı ve parola | `/etc/getirbakim-egress/passwords` (Git'te değil) | 407 |

Squid host ağında çalışır (`network_mode: host`). Docker'ın yayınladığı portlar ufw'yi atlar; host ağıyla ufw kuralı gerçekten uygulanır ve squid gerçek istemci adresini görür.

## Kurulum (VPS, root)

Ayrı bir onayla yapılır. Uygulama stack'inden bağımsızdır, mevcut servisleri yeniden başlatmaz.

Dosyalar prod repo checkout'una değil, ayrı bir dizine kopyalanır: prod deploy'u checkout'ta `git reset --hard` yapar ve çalışan proxy'nin yapılandırmasını silebilir.

```bash
# Yerelde (repo kökü):
ssh root@173.249.36.2 install -d -m 755 /opt/getirbakim-egress
scp infra/squid/{squid.conf,allowed-clients.txt,allowed-hosts.txt,compose.yml,README.md} root@173.249.36.2:/opt/getirbakim-egress/

# VPS'te:
cd /opt/getirbakim-egress

# 1. Parola: rastgele üretilir, ekrana yazılmaz. Uygulama ayarı root-only dosyada durur;
#    oradan Bitwarden Send ile partnere (Secrets Manager) iletilir.
install -d -m 700 /etc/getirbakim-egress
umask 077
PASS="$(openssl rand -hex 24)"
printf 'getirbakim:%s\n' "$(openssl passwd -apr1 "$PASS")" > /etc/getirbakim-egress/passwords
chmod 644 /etc/getirbakim-egress/passwords   # squid 'proxy' kullanıcısı okuyabilmeli; içerik yalnız hash
printf 'SUPPLIER_EGRESS_PROXY=http://getirbakim:%s@173.249.36.2:3128\nSUPPLIER_EGRESS_PROXY_FOR=dinamik\n' "$PASS" > /etc/getirbakim-egress/app-env
unset PASS

# 2. Güvenlik duvarı: 3128 yalnız AWS çıkış IP'sine açık.
ufw allow from 18.194.217.212 to any port 3128 proto tcp comment 'getirbakim egress proxy (AWS NAT)'

# 3. Başlat ve doğrula.
docker compose -f compose.yml up -d
docker compose -f compose.yml exec squid squid -k parse 2>&1 | grep -iE 'error|fatal' || echo "config OK"
ss -ltnp | grep 3128
```

Olumlu yol VPS'ten test edilecekse istemci adresi VPS'in dış IP'sidir (proxy adresi 173.249.36.2 olduğu için 127.0.0.1 değil): `allowed-clients.txt`'e geçici olarak `173.249.36.2/32` ekle, restart, `curl -x "$SUPPLIER_EGRESS_PROXY" https://dinamikapp-api.dinamik.online/` ile `http_connect` 200 gör, satırı geri al ve restart. Dinamik'in sunucusu ara sertifikayı göndermediği için curl'ün TLS doğrulaması burada başarısız olur (`http_code` 000); uygulama ara sertifikayı sabitlediği için etkilenmez.

`squid -k parse` çıktısındaki `WARNING: HTTP requires the use of Via` beklenen bir uyarıdır (`via off` bilinçli).

## Uygulama ayarı (AWS, Secrets Manager)

```
SUPPLIER_EGRESS_PROXY=http://getirbakim:<parola>@173.249.36.2:3128
SUPPLIER_EGRESS_PROXY_FOR=dinamik            # Başbuğ'da IP kısıtı yok; gerekirse liste genişletilir
```

- Ayar yoksa uygulama doğrudan çıkar (bugünkü VPS davranışı). VPS üzerindeki mevcut kurulumda bu ayar **tanımlanmaz**.
- `DINAMIK_DIRECT_TUNNEL` (yerel geliştirme SSH tüneli) ile birlikte kullanılamaz.
- Dinamik sipariş anındaki stok kontrolü (`getStock`) de bu yoldan gider. VPS ya da proxy kapalıysa Dinamik senkronizasyonu ve Dinamik ürünlerinin ödeme adımı durur.

## Kontrol

Komutlar `/opt/getirbakim-egress` içinde çalıştırılır.

AWS'ten (ör. ECS Exec ile app task'ı içinde):

```bash
curl -sS -o /dev/null -w '%{http_connect} %{http_code}\n' -x "$SUPPLIER_EGRESS_PROXY" https://dinamikapp-api.dinamik.online/
# 200 <tedarikçinin yanıtı>: tünel çalışıyor.  407: parola.  403: IP, host ya da port.
```

VPS'te kayıt (zaman, istemci, kullanıcı, `CONNECT host:port`, durum, bayt; istek içeriği yok):

```bash
docker compose -f compose.yml exec squid tail -f /var/log/squid/access.log
```

## Değişiklikler

- AWS çıkış IP'si değişirse: `allowed-clients.txt` ve ufw kuralını güncelle, `docker compose -f compose.yml restart`.
- Yeni tedarikçi host'u: `allowed-hosts.txt`, ardından restart. Uygulamada `SUPPLIER_EGRESS_PROXY_FOR` listesine tedarikçiyi ekle.
- `www.parts2world.com` tedarikçi değil, zenginleştirme kaynağıdır (görseller de aynı host): `SUPPLIER_EGRESS_PROXY_FOR` listesine eklenmez; `scripts/parts2world-enrichment.ts collect|fetch-types --via-proxy` ile açıkça seçilir (#946). VPS'te dosyaya inode'u koruyarak ekle (`>>`), ardından `squid -k reconfigure`.
- Parola yenileme: 1. adımı tekrarla, Secrets Manager'ı güncelle, restart.

## Kaldırma

Dinamik AWS IP'sini ekledi (16 Kasım 2026). Proxy kapatılacaksa: önce uygulamadan `SUPPLIER_EGRESS_PROXY` kaldırılır ve senkronizasyon doğrulanır, sonra:

```bash
docker compose -f compose.yml down -v
ufw delete allow from 18.194.217.212 to any port 3128 proto tcp
rm -rf /etc/getirbakim-egress /opt/getirbakim-egress
```
