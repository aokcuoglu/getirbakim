# Kurumsal ve yasal içerik revizyonu

3 Ekim 2026 tarihinde sekiz sayfanın metinleri Türkçe yazım ve noktalama kuralları, resmî tüketici/KVKK kaynakları ve uygulamanın mevcut işlevleri esas alınarak yeniden düzenlendi. Sayfalar `src/content/legal-pages.json` üzerinden sunulur. Kaynak siteden alınan ilk sürüm `docs/legal/imported-source-2026-10-03.json` dosyasında arşivlenmiştir. `sourceUpdatedAt` kaynak metnin, `updatedAt` revize metnin tarihidir.

## Kapsam

İletişim, teslimat ve iade, mesafeli satış sözleşmesi, ön bilgilendirme formu, üyelik ve kullanım koşulları, gizlilik politikası, KVKK aydınlatma metni ve çerez politikası düzenlendi. Şirketin kaynakta bulunan ticaret unvanı ve kayıt numaraları aynen korundu; adres ve etiketlerin Türkçe yazımı düzeltildi. Resmî sicil doğrulaması yapılmadı.

Tüketici ve ticari servis işlemlerinin kapsamı ayrıldı. Cayma bildirimi, geri gönderme ve bedel iadesi süreleri ayrı açıklandı; iade şirket onayına bağlanmadı. Ambalaj, montaj ve araca uygunluk için genel ret hükümleri kaldırıldı; kanuni istisnaların koşulları belirtildi. Ayıplı mala ilişkin seçimlik haklar, teslimat sorumluluğu ve stok yokluğunun ifa imkânsızlığı olmadığı açıklandı. Örnek cayma bildirimi eklendi. Genel sayfaların siparişe özgü sözleşme veya ön bilgilendirme yerine geçmediği belirtildi.

KVKK hakları tamamlandı; amaç ve hukuki sebepler mevcut hesap/sepet/garaj işlevleriyle eşleştirildi. Başvuru yöntemleri, 30 günlük cevap süresi ve Kurula şikâyet süreleri açıklandı. Aydınlatma ve açık rıza ayrı tutuldu; üyelik ekranındaki gizlilik politikasını zorunlu kabul ifadesi kaldırıldı. Çerez ve yerel depolama ayrımı ile fiilî kayıt adları ve süreleri açıklandı. Tüketici metinlerinin gövdesi 16 CSS pikseli (12 punto) boyutunda gösterilir.

## Kullanıcının doğruladığı fiilî durum

- Bu proje henüz yayımlanmadı; yerel ortamda çalışıyor.
- AWS Almanya/Frankfurt bölgesine yayımlama planlanıyor; aktarım başlamadı.
- Mevcut durumda kişisel veri paylaşılan e-posta, ödeme veya kargo sağlayıcısı bulunmuyor.
- Kodda sipariş/ödeme, açık üyelik, sosyal giriş ve pazarlama gönderimi etkin değil; analitik/reklam entegrasyonu yok.

Metinler uygulanmış bir AWS aktarım mekanizması veya tamamlanmış saklama/imha takvimi varmış gibi taahhüt içermez. Şirket, bu fiilî bilgilerin değişmesiyle metinleri güncellemelidir.

## Hukuki dayanakların kontrolü

Tüketici süreleri için Ticaret Bakanlığının 17 Ağustos 2026 tarihli güncel açıklaması esas alındı. Bakanlığın aşağıdaki yönetmelik PDF'si eski geçiş hükümleri de içerdiğinden, 2026 süreleri için tek başına kullanılmadı.

- [Mesafeli sözleşmeler hakkında güncel bilgilendirme — Ticaret Bakanlığı](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/mesafeli-sozlesmeler-hakkinda-bilgilendirme): cayma, geri gönderme, bedel iadesi ve taşıyıcı giderleri.
- [Mesafeli Sözleşmeler Yönetmeliği — Ticaret Bakanlığı](https://tuketici.ticaret.gov.tr/data/5e819a8e13b876a1b04c7a4a/Mesafeli%20S%C3%B6zle%C5%9Fmeler%20Y%C3%B6netmeli%C4%9Fi.pdf): m. 5–11, 15–20; bilgilendirme, istisnalar, ifa, sorumluluk ve kayıtlar.
- [Ayıplı mal ve hizmetler — Ticaret Bakanlığı](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/ayipli-mal-ve-hizmetler-hakkinda-bilgilendirme): seçimlik haklar ve zamanaşımı.
- [Tüketici sözleşmelerinde temel ilkeler — Ticaret Bakanlığı](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/tuketici-sozlesmelerindeki-temel-ilkeler-ve-haksiz-sartlar-hakkinda-bilgilendirme): anlaşılır metin, en az 12 punto, tüketici aleyhine değişiklikler.
- [Tüketici uyuşmazlıklarında arabuluculuk — Ticaret Bakanlığı](https://tuketici.ticaret.gov.tr/duyurular/tuketici-hakem-heyetleri-gorev-alanindaki-uyusmazliklar-zorunlu-arabuluculuk-kaps): dava şartı ve istisnalar; eski parasal sınır metne alınmadı.
- [Aydınlatma yükümlülüğüne ilişkin kamuoyu duyurusu — KVKK](https://www.kvkk.gov.tr/Icerik/6765/AYDINLATMA-YUKUMLULUGUNUN-YERINE-GETIRILMESI-HAKKINDA-KAMUOYU-DUYURUSU): fiilî faaliyetlere özgü aydınlatma ve açık rızadan ayrılması.
- [Haklar ve başvuruların usul şartları — KVKK](https://www.kvkk.gov.tr/Icerik/6938/Kurumumuza-Yapilan-Sikayetlerin-Usul-Sartlarina-Iliskin-Kamuoyu-Duyurusu): m. 11 ve başvuru yöntemleri.
- [Başvuruların cevaplanması — KVKK](https://www.kvkk.gov.tr/Icerik/9024/ilgili-kisilerin-basvurularina-verilecek-cevabin-bildirim-usulune-iliskin-kamuoyu-duyurusu): 30 gün ve cevap yöntemi.
- [Şikâyet hakkı — KVKK](https://www.kvkk.gov.tr/Icerik/2063/Sikayet-Hakki): 30/60 günlük süreler.
- [Çerez Uygulamaları Hakkında Rehber — KVKK](https://www.kvkk.gov.tr/Icerik/7353/Cerez-Uygulamalari-Hakkinda-Rehber): gerekli işlevler, hukuki dayanak ve tercih yönetimi.
- [2024 Kanun değişikliği — KVKK](https://www.kvkk.gov.tr/Icerik/7834/6698-Sayili-Kisisel-Verilerin-Korunmasi-Kanununda-Yapilan-Degisiklikler-Hakkinda-Kamuoyu-Duyurusu): güncel yurt dışına aktarım rejimi.
- [Standart sözleşmelerde dikkat edilecek hususlar — KVKK](https://www.kvkk.gov.tr/Icerik/8170/Yurt-Disina-Kisisel-Veri-Aktariminda-Kullanilacak-Standart-Sozlesmelerde-Dikkat-Edilmesi-Gereken-Hususlara-Iliskin-Kamuoyu-Duyurusu): doğru sözleşme tipi, imza ve beş iş günlük bildirim.

## Yayımlamadan veya satışa başlamadan önce tamamlanacak işler

AWS hizmetinin gerçek sözleşme tarafı, erişim/alt işleyen zinciri ve yurt dışına aktarım mekanizması belirlenmelidir. Gerekliyse KVKK standart sözleşmesi imzalanıp süresinde bildirilmelidir; genel AWS sözleşmesinin varlığı bunu tek başına karşılamaz. Bu çalışma kapsamında sözleşme imzalama, bildirim veya deploy yapılmadı.

Veri kategorilerine göre somut saklama süreleri ve uygulanacak imha işlemleri belirlenip teknik olarak hayata geçirilmelidir. Çerezlerin sona ermesi, sunucu kayıtlarının fiziksel olarak silindiği anlamına gelmez.

Satış açılırken kargo taşıyıcısı ve teslimat koşulları belirlenmeli; siparişe özgü ön bilgilendirme ve sözleşme oluşturma, teyit, kalıcı veri saklayıcısıyla iletme ve kayıt saklama uygulanmalıdır. Ödeme sağlayıcısı, fiyatlar ve ürün bazlı cayma istisnaları fiilî duruma göre açıklanmalıdır. Sunulmayan ödeme/kampanya seçenekleri metinlerde vaat edilmez.

Bu revizyon genel hukuki ve teknik hazırlıktır; şirketin bütün süreçlerinin mevzuata uygunluğu bakımından bir hukukçu incelemesinin veya uygulama denetiminin yerine geçmez.
