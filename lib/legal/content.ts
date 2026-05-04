import {
  LEGAL_PAGE_SLUGS,
  type CompanyProfile,
  type LegalDocument,
  type LegalLocale,
  type LegalPageKey,
  type LegalSection,
  type PolicyDefaults
} from './types'

export const PLACEHOLDER_COMPANY_PROFILE: CompanyProfile = {
  brandName: 'Ergul Enerji',
  legalName: 'ERGUL ENERJI SAN TIC LTD STI',
  mersisNo: '0357042224900019',
  taxOffice: 'KARTAL VERGI DAIRESI',
  taxNo: '3570422249',
  tradeRegistryNo: '64972-5',
  supportEmail: 'info@ergulenerji.com',
  supportPhone: '0216 387 00 78',
  supportWhatsapp: '+90 535 835 57 75',
  kepEmail: 'ergulenerji@hs03.kep.tr',
  openAddress:
    'Esentepe Mahallesi Kartal Oto Sanayi Sitesi C1 Blok No:25 Kartal / Istanbul / Turkiye',
  workingHours: '09:00 - 17:30'
}

export const POLICY_DEFAULTS: PolicyDefaults = {
  cancellationWindowDays: 14,
  returnWindowDays: 14,
  standardDeliveryWindow: '1-3 is gunu',
  expressDeliveryWindow: 'ertesi is gunu',
  freeShippingThresholdTry: 1500
}

const TEMPLATE_NOTICE_TR: LegalSection = {
  heading: 'Onemli Bilgilendirme',
  paragraphs: [
    'Bu metin operasyonel taslak olarak hazirlanmistir ve canliya alinmadan once hukuk danismani tarafindan kontrol edilmelidir.',
    'Sitede siparis onayi esnasinda gosterilen guncel metin surumu esas alinmali, metin degisiklikleri tarih bilgisi ile kayit altinda tutulmalidir.'
  ]
}

const TEMPLATE_NOTICE_EN: LegalSection = {
  heading: 'Important Notice',
  paragraphs: [
    'This document is prepared as an operational draft and should be reviewed by legal counsel before production use.',
    'The latest version presented during checkout should be treated as binding and all revisions should be logged with an update date.'
  ]
}

const LEGAL_DOCUMENTS_TR: Record<LegalPageKey, LegalDocument> = {
  distanceSales: {
    key: 'distanceSales',
    slug: LEGAL_PAGE_SLUGS.distanceSales,
    title: 'Mesafeli Satis Sozlesmesi',
    summary:
      'Bu sozlesme, internet sitesi uzerinden verilen siparislerde taraflarin hak ve yukumluluklerini 6502 sayili Kanun ve ilgili mevzuat kapsaminda duzenler.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Hukuki Dayanak ve Kapsam',
        paragraphs: [
          'Bu sozlesme, 6502 sayili Tuketicinin Korunmasi Hakkinda Kanun ve Mesafeli Sozlesmeler Yonetmeligi kapsaminda, elektronik ortamda kurulan satis sozlesmeleri icin uygulanir.',
          'Platform, pazar yeri, web sitesi veya mobil uygulama uzerinden kurulan tum mesafeli satis islemlerinde bu metin temel hukuki cerceveyi olusturur.'
        ]
      },
      {
        heading: 'Taraf Bilgileri',
        paragraphs: [
          `Satici: ${PLACEHOLDER_COMPANY_PROFILE.legalName}`,
          `MERSIS: ${PLACEHOLDER_COMPANY_PROFILE.mersisNo} | Vergi Dairesi/No: ${PLACEHOLDER_COMPANY_PROFILE.taxOffice} / ${PLACEHOLDER_COMPANY_PROFILE.taxNo}`,
          `Iletisim: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          'Alici, siparis ekraninda beyan ettigi ad-soyad, iletisim ve teslimat bilgileri ile sozlesmenin diger tarafidir.'
        ]
      },
      {
        heading: 'Sozlesmenin Kurulmasi ve Siparis Akisi',
        paragraphs: [
          'Alici, urunleri sepetine ekleyip odeme adimina ilerledikten sonra on bilgilendirme formu ve bu sozlesmeyi onaylayarak siparisi tamamlar.',
          'Siparisin olusmasi, odemenin basariyla alinmasi ve siparis onay mesajinin aliciya iletilmesi ile kesinlesir.'
        ],
        bullets: [
          'Sepet icerigi, birim fiyat, kargo ucreti ve toplam tutar siparis oncesinde acikca gosterilir.',
          'Sistemsel hata nedeniyle olusan acik fiyat/stok uyumsuzluklarinda siparis teyidi yeniden degerlendirilebilir.',
          'Siparis kayitlari, mevzuata uygun surelerle saklanir ve talep halinde yetkili mercilere sunulabilir.'
        ]
      },
      {
        heading: 'Fiyatlandirma, Odeme ve Fatura',
        paragraphs: [
          'Satis fiyatlari urun detay ve odeme ekraninda KDV dahil/haric bilgisi ile birlikte gosterilir. Kampanya, kupon ve kargo indirimleri siparis aninda uygulanan kosullara tabidir.',
          'Odeme, secilen yonteme gore guvenli odeme altyapisi uzerinden tahsil edilir. Kart bilgileri is yerinde tutulmaz, yetkili odeme saglayicilari uzerinden islenir.',
          'Fatura, e-fatura/e-arsiv mevzuatina uygun olarak alici bilgileri ile duzenlenir.'
        ]
      },
      {
        heading: 'Teslimat ve Ifa',
        paragraphs: [
          `Siparisler stok ve operasyon durumuna gore genel olarak ${POLICY_DEFAULTS.standardDeliveryWindow}, hizli teslimat seceneginde ${POLICY_DEFAULTS.expressDeliveryWindow} icinde kargoya verilir.`,
          'Teslimat yalnizca sipariste belirtilen adrese ve kargo prosedurlerine uygun sekilde yapilir. Alici teslimatta paket dis hasar kontrolunu yapmakla yukumludur.'
        ],
        bullets: [
          'Resmi tatil, olaganustu hava kosullari, operasyonel yogunluk gibi hallerde teslim suresi degisebilir.',
          'Urunun tesliminin imkansizlastigi hallerde alici bilgilendirilir ve tahsil edilen tutar mevzuata uygun surede iade edilir.',
          'Kismi sevkiyat gereken siparislerde aliciya parcali teslimat bilgilendirmesi yapilabilir.'
        ]
      },
      {
        heading: 'Cayma Hakki, Iade ve Istisnalar',
        paragraphs: [
          `Alici, urunu teslim aldigi tarihten itibaren ${POLICY_DEFAULTS.cancellationWindowDays} gun icinde cayma hakkini kullanabilir. Cayma bildirimi kalici veri saklayicisi ile iletilebilir.`,
          'Cayma halinde iade kosullari, urunun niteligine gore degisir; hijyen, tek kullanim, montaj ve kisisellestirme gibi durumlarda yasal istisnalar uygulanabilir.'
        ],
        bullets: [
          'Iade edilecek urunler, tekrar satisa uygun durumda ve varsa tum aksesuarlari ile gonderilmelidir.',
          'Araca ozel siparis edilen, kullanilmis veya hasarlanmis urunlerde iade talebi sinirli olabilir.',
          'Iade nakliye masrafinin kim tarafindan karsilanacagi, siparis oncesi bilgilendirme metninde acikca belirtilir.'
        ]
      },
      {
        heading: 'Ayipli Mal, Garanti ve Sorumluluk',
        paragraphs: [
          'Alici, urunde ayip oldugunu dusundugu hallerde urunu teslim aldigi andan itibaren makul surede saticiya bildirmelidir.',
          'Ayipli mal talepleri, urunun teknik incelemesi sonrasinda mevzuat kapsaminda onarim, degisim, bedel indirimi veya sozlesmeden donme secenekleriyle sonuclandirilir.'
        ]
      },
      {
        heading: 'Mucbir Sebep ve Uyusmazlik Cozumu',
        paragraphs: [
          'Taraflarin kontrolu disinda gelisen yangin, deprem, salgin, savas, ulasim ve altyapi kesintileri gibi mucbir sebep hallerinde ifa gecikebilir.',
          'Uyusmazlik halinde, ilgili yilin parasal sinirlari dahilinde Tuketici Hakem Heyetleri ve Tuketici Mahkemeleri yetkilidir.'
        ]
      }
    ]
  },
  preInformation: {
    key: 'preInformation',
    slug: LEGAL_PAGE_SLUGS.preInformation,
    title: 'On Bilgilendirme Formu',
    summary:
      'Siparis oncesinde aliciya sunulmasi gereken temel bilgiler, odeme ve teslimat kosullari ile cayma hakki bu formda aciklanir.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Satici ve Iletisim Bilgileri',
        paragraphs: [
          `Unvan: ${PLACEHOLDER_COMPANY_PROFILE.legalName}`,
          `MERSIS: ${PLACEHOLDER_COMPANY_PROFILE.mersisNo} | Ticaret Sicil No: ${PLACEHOLDER_COMPANY_PROFILE.tradeRegistryNo}`,
          `Vergi Dairesi/No: ${PLACEHOLDER_COMPANY_PROFILE.taxOffice} / ${PLACEHOLDER_COMPANY_PROFILE.taxNo}`,
          `Iletisim: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          `Acik Adres: ${PLACEHOLDER_COMPANY_PROFILE.openAddress}`
        ]
      },
      {
        heading: 'Urun/Hizmet Temel Nitelikleri ve Toplam Bedel',
        paragraphs: [
          'Siparise konu urunlerin teknik ozellikleri, marka/model bilgisi, adet ve birim fiyat bilgisi urun ve sepet ekraninda gosterilir.',
          'Odeme oncesinde ara toplam, kargo bedeli, varsa indirimler ve odenecek genel toplam aliciya acikca sunulur.'
        ],
        bullets: [
          'Fiyatlara KDV dahildir veya mevzuata uygun sekilde ayrica belirtilir.',
          'Kampanya kosullari stok, sure ve kanal bazli olarak degisebilir.',
          'Kur farki veya tedarikci kaynakli fiyat degisimi siparis olusmadan once ekrana yansitilir.'
        ]
      },
      {
        heading: 'Odeme Yontemleri ve Guvenlik',
        paragraphs: [
          'Sistem, kredi karti, taksitli odeme, havale/EFT veya kapida odeme gibi secenekler sunabilir. Sunulan secenekler odeme adiminda goruntulenir.',
          'Odeme islemleri, PCI DSS standartlarina uyumlu odeme hizmet saglayicilari araciligiyla gerceklestirilir; kart verileri satici sisteminde saklanmaz.'
        ]
      },
      {
        heading: 'Teslimat Bilgileri',
        paragraphs: [
          `Standart teslimat hedef suresi ${POLICY_DEFAULTS.standardDeliveryWindow}, hizli teslimat hedef suresi ${POLICY_DEFAULTS.expressDeliveryWindow} olarak planlanir.`,
          `Belirli kampanyalarda ${POLICY_DEFAULTS.freeShippingThresholdTry} TRY ve uzeri sepetlerde ucretsiz kargo uygulanabilir.`
        ],
        bullets: [
          'Teslimat suresi, odeme onayi ve urunun depodan cikis zamanina gore hesaplanir.',
          'Alicinin eksik/hatali adres bildirmesi kaynakli gecikmelerden satici sorumlu tutulamaz.',
          'Mucbir sebep veya lojistik kesinti hallerinde yeni teslimat tarihi bilgilendirmesi yapilir.'
        ]
      },
      {
        heading: 'Cayma Hakki ve Iade Bilgisi',
        paragraphs: [
          `Alici, teslim tarihinden itibaren ${POLICY_DEFAULTS.cancellationWindowDays} gun icinde cayma hakkini kullanabilir.`,
          `Iade sureci, urun tipi ve yasal istisnalar dikkate alinarak en gec ${POLICY_DEFAULTS.returnWindowDays} gunluk operasyonel surec icinde sonuclandirilir.`
        ],
        bullets: [
          'Cayma hakki kapsaminda urun iadesi icin siparis numarasi ile talep olusturulmasi gerekir.',
          'Koruyucu unsurlari acilmis, montajlanmis veya tekrar satilamayacak urunlerde yasal istisnalar uygulanabilir.',
          'Iade onayi sonrasinda geri odeme, alicinin odeme aracina mevzuata uygun surede yapilir.'
        ]
      },
      {
        heading: 'Sikayet ve Basvuru Kanallari',
        paragraphs: [
          `Musteri hizmetleri: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          `KEP iletisim: ${PLACEHOLDER_COMPANY_PROFILE.kepEmail}`,
          'Alici, uyusmazlik halinde ilgili yilin parasal sinirlari dahilinde Tuketici Hakem Heyetine veya Tuketici Mahkemesine basvurabilir.'
        ]
      },
      {
        heading: 'Onay Beyani',
        paragraphs: [
          'Alici, siparisi tamamlamadan once bu formda yer alan tum maddeleri okuyup anladigini ve elektronik ortamda onay verdigini kabul eder.',
          'Satici, on bilgilendirme metnini ve onay kaydini mevzuat kapsaminda saklar.'
        ]
      }
    ]
  },
  privacyPolicy: {
    key: 'privacyPolicy',
    slug: LEGAL_PAGE_SLUGS.privacyPolicy,
    title: 'Gizlilik Politikasi',
    summary:
      'Kisisel verilerin toplanmasi, islenmesi, aktarimi, saklanmasi ve haklarinizin kullanimi bu politika kapsaminda aciklanir.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Kapsam ve Veri Sorumlusu',
        paragraphs: [
          `${PLACEHOLDER_COMPANY_PROFILE.legalName}, bu internet sitesi ve bagli uygulamalar kapsaminda veri sorumlusu sifatini tasir.`,
          'Politika; ziyaretciler, uyeler, musteriler, tedarikciler ve iletisim formlari uzerinden veri ileten tum kisileri kapsar.'
        ]
      },
      {
        heading: 'Islenen Veri Kategorileri',
        paragraphs: ['Hizmetin niteligine gore asagidaki veri kategorileri islenebilir.'],
        bullets: [
          'Kimlik bilgileri: ad, soyad, unvan bilgileri.',
          'Iletisim bilgileri: e-posta, telefon, adres bilgileri.',
          'Musteri islem bilgileri: siparis gecmisi, iade kayitlari, odeme durumu.',
          'Islem guvenligi verileri: IP adresi, log kayitlari, oturum hareketleri.',
          'Talep/sikayet verileri: cagrimerkezi, form ve destek kayitlari.'
        ]
      },
      {
        heading: 'Veri Toplama Yontemleri ve Amaclari',
        paragraphs: [
          'Veriler; uyelik formlari, siparis ekranlari, cerezler, cagri merkezi, e-posta yazismalari ve teknik loglar araciligiyla toplanabilir.',
          'Toplanan veriler; siparis ifasi, odeme ve teslimat operasyonu, musteri destegi, dolandiricilik onleme, finans/muhasebe ve yasal yukumluluklerin yerine getirilmesi amaclariyla islenir.'
        ]
      },
      {
        heading: 'Hukuki Sebepler',
        paragraphs: [
          'Veri isleme faaliyetleri; sozlesmenin kurulmasi/ifasi, hukuki yukumluluklerin yerine getirilmesi, mesru menfaat ve acik riza hukuki sebeplerine dayanabilir.',
          'Acik riza gerektiren hallerde kullaniciya secim imkani sunulur; riza geri cekildiginde ilgili islem faaliyetleri durdurulur.'
        ]
      },
      {
        heading: 'Veri Aktarimi',
        paragraphs: [
          'Kisisel veriler; odeme kuruluslari, kargo firmalari, teknik altyapi saglayicilari, bagimsiz denetim/muhasebe partnerleri ve yetkili kamu kurumlariyla mevzuata uygun sinirlar dahilinde paylasilabilir.',
          'Yurt disi aktarim gerektiren senaryolarda KVKK ve ikincil duzenlemelere uygun guvence mekanizmalari uygulanir.'
        ]
      },
      {
        heading: 'Saklama Sureleri ve Imha',
        paragraphs: [
          'Veriler, isleme amacinin gerektirdigi sure boyunca ve ilgili mevzuatta ongorulen zorunlu saklama sureleri kadar tutulur.',
          'Saklama suresi dolan veriler, periyodik imha politikalari kapsaminda silinir, yok edilir veya anonim hale getirilir.'
        ]
      },
      {
        heading: 'Guvenlik Tedbirleri',
        paragraphs: [
          'Yetkisiz erisim, veri kaybi ve degisikligi onlemek icin teknik ve idari tedbirler uygulanir; erisim yetkileri gorev bazli olarak sinirlandirilir.',
          'Sistem guvenligi surekli izlenir; risk tespiti halinde olay yonetimi ve gerekli bildirim mekanizmalari devreye alinabilir.'
        ]
      },
      {
        heading: 'Haklariniz ve Basvuru Yontemi',
        paragraphs: [
          'Ilgili kisi olarak KVKK kapsamindaki haklarinizi kullanmak icin veri sorumlusuna basvurabilirsiniz.',
          `Basvurularinizi ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} e-posta adresine veya ${PLACEHOLDER_COMPANY_PROFILE.kepEmail} KEP adresine iletebilirsiniz.`
        ],
        bullets: [
          'Verinizin islenip islenmedigini ogrenme.',
          'Isleme amacini ve aktarim alicilarini ogrenme.',
          'Eksik/yanlis verinin duzeltilmesini isteme.',
          'Kanuni sartlarda silme/yok etme talep etme.',
          'Kanuna aykiri isleme nedeniyle zararin giderilmesini talep etme.'
        ]
      }
    ]
  },
  deliveryAndReturns: {
    key: 'deliveryAndReturns',
    slug: LEGAL_PAGE_SLUGS.deliveryAndReturns,
    title: 'Teslimat ve Iade Kosullari',
    summary:
      'Siparisin hazirlanmasindan teslimata, iade talebinden geri odeme asamasina kadar tum surecler bu metinde adim adim aciklanir.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Siparis Hazirlama ve Kargolama',
        paragraphs: [
          'Siparisler, odeme onayi sonrasinda depoda toplama-kontrol-paketleme asamalarindan gecirilir ve anlasmali kargo firmasina teslim edilir.',
          'Ayni sipariste birden fazla urun bulunmasi halinde parcali sevkiyat yapilabilir.'
        ]
      },
      {
        heading: 'Teslimat Sureleri ve Kapsam',
        paragraphs: [
          `Standart teslimat hedef suresi ${POLICY_DEFAULTS.standardDeliveryWindow}, hizli teslimat hedef suresi ${POLICY_DEFAULTS.expressDeliveryWindow} olarak belirlenmistir.`,
          `Belirli kampanya donemlerinde ${POLICY_DEFAULTS.freeShippingThresholdTry} TRY ve uzeri siparislerde ucretsiz kargo uygulanabilir.`
        ],
        bullets: [
          'Teslimat sureleri tahmini surelerdir; resmi tatil, hava kosullari ve bolgesel yogunluklar sureyi etkileyebilir.',
          'Adresin eksik/yanlis beyan edilmesi durumunda teslimat gecikebilir veya iade donusu olusabilir.',
          'Kargo takibi, siparis paneli veya bilgilendirme mesajlari uzerinden saglanir.'
        ]
      },
      {
        heading: 'Teslimat Aninda Kontrol',
        paragraphs: [
          'Paket teslim alinirken dis ambalaj hasari, urun adedi ve fatura/irsaliye kontrolu yapilmalidir.',
          'Gorunur hasar halinde kargo gorevlisi esliginde tutanak tutulmasi, sonrasindaki iade ve hasar talepleri icin onemlidir.'
        ]
      },
      {
        heading: 'Iade Talebi Sartlari',
        paragraphs: [
          `Iade talepleri urun teslim tarihinden itibaren en gec ${POLICY_DEFAULTS.returnWindowDays} gun icinde olusturulmalidir.`,
          'Urunlerin tekrar satisa uygun, eksiksiz ve orijinal aksesuar/ambalajlari ile birlikte gonderilmesi beklenir.'
        ],
        bullets: [
          'Kisisellestirilmis veya araca ozel tedarik edilen urunlerde iade hakki mevzuattaki istisnalara tabi olabilir.',
          'Montaj gormus, kullanim izi bulunan veya hasarli urunlerde iade reddedilebilir.',
          'Hijyen sebebiyle iadesi uygun olmayan urunlerde yasal sinirlamalar uygulanir.'
        ]
      },
      {
        heading: 'Cayma Hakki Kapsaminda Iade Adimlari',
        paragraphs: [
          `Alici, ${POLICY_DEFAULTS.cancellationWindowDays} gunluk cayma suresi icinde destek kanallarimizdan bildirim yaparak iade surecini baslatabilir.`,
          'Onayli iade talebinde urun kargo kodu ile gonderilir ve depoya ulasim sonrasi teknik/operasyonel kontrol yapilir.'
        ],
        bullets: [
          'Iade talebinde siparis numarasi ve iade nedeni belirtilmelidir.',
          'Kargo teslim fisinin saklanmasi tavsiye edilir.',
          'Iade sonucu e-posta veya panel uzerinden kullaniciya bildirilir.'
        ]
      },
      {
        heading: 'Geri Odeme Sureci',
        paragraphs: [
          'Iadesi onaylanan urunlerde geri odeme, odemenin yapildigi araca mevzuatta belirtilen surelerde baslatilir.',
          'Banka/kart kurumu kaynakli yansima sureleri satici kontrolu disinda oldugundan hesaba gecis tarihi farklilik gosterebilir.'
        ]
      },
      {
        heading: 'Degisim ve Destek',
        paragraphs: [
          'Uygun durumlarda urun degisimi, stok mevcudiyeti ve operasyon uygunlugu dahilinde saglanabilir.',
          `Iletisim: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`
        ]
      }
    ]
  },
  contact: {
    key: 'contact',
    slug: LEGAL_PAGE_SLUGS.contact,
    title: 'Iletisim',
    summary:
      'Musteri hizmetleri, acik adres, kurumsal bilgiler ve resmi tebligat kanallari bu sayfada yer alir.',
    lastUpdated: '2026-03-12',
    sections: [
      {
        heading: 'Musteri Hizmetleri',
        paragraphs: [
          `Telefon: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone}`,
          `WhatsApp Destek: ${PLACEHOLDER_COMPANY_PROFILE.supportWhatsapp}`,
          `E-posta: ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          `Calisma Saatleri: ${PLACEHOLDER_COMPANY_PROFILE.workingHours}`
        ],
        bullets: [
          'Siparis, teslimat, iade ve odeme sorulari icin destek alinabilir.',
          'Yogun donemlerde geri donus suresi uzayabilir; tum talepler kayit altina alinir.',
          'Sikayetlerin daha hizli sonuclanmasi icin siparis numarasi paylasilmasi onerilir.'
        ]
      },
      {
        heading: 'Acik Adres ve Iade Noktasi',
        paragraphs: [
          `Merkez Adres: ${PLACEHOLDER_COMPANY_PROFILE.openAddress}`,
          'Iade adresi, merkez adres ile aynidir.'
        ]
      },
      {
        heading: 'Kurumsal Bilgiler',
        paragraphs: [
          `Unvan: ${PLACEHOLDER_COMPANY_PROFILE.legalName}`,
          `Ticaret Sicil No: ${PLACEHOLDER_COMPANY_PROFILE.tradeRegistryNo}`,
          `MERSIS No: ${PLACEHOLDER_COMPANY_PROFILE.mersisNo}`,
          `Vergi Dairesi/No: ${PLACEHOLDER_COMPANY_PROFILE.taxOffice} / ${PLACEHOLDER_COMPANY_PROFILE.taxNo}`
        ]
      },
      {
        heading: 'Resmi Tebligat ve KVKK Basvuru Kanali',
        paragraphs: [
          `KEP: ${PLACEHOLDER_COMPANY_PROFILE.kepEmail}`,
          'Resmi kurum yazismalari, ihtar ve KVKK kapsamindaki basvurular icin bu kanal kullanilabilir.'
        ]
      }
    ]
  },
  kvkkDisclosure: {
    key: 'kvkkDisclosure',
    slug: LEGAL_PAGE_SLUGS.kvkkDisclosure,
    title: 'KVKK Aydinlatma Metni',
    summary:
      '6698 sayili Kisisel Verilerin Korunmasi Kanunu kapsaminda veri isleme faaliyetleri, hukuki sebepler ve ilgili kisi haklari bu metinde aciklanir.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Veri Sorumlusu Kimligi',
        paragraphs: [
          `${PLACEHOLDER_COMPANY_PROFILE.legalName}, KVKK kapsaminda veri sorumlusu sifatini tasir.`,
          `Iletisim: ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} | ${PLACEHOLDER_COMPANY_PROFILE.supportPhone}`
        ]
      },
      {
        heading: 'Islenen Kisisel Veri Kategorileri',
        paragraphs: ['Faaliyet kapsamina gore islenebilecek baslica veri kategorileri asagidadir.'],
        bullets: [
          'Kimlik ve iletisim bilgileri.',
          'Musteri islem, siparis ve iade bilgileri.',
          'Odeme ve finansal islem kayitlari (kart numarasi haric).',
          'Islem guvenligi, log ve cihaz kayitlari.',
          'Talep/sikayet ve destek gorusme kayitlari.'
        ]
      },
      {
        heading: 'Veri Isleme Amaclari',
        paragraphs: [
          'Siparislerin alinmasi, odeme ve teslimat operasyonlarinin yurutulmesi, iade sureclerinin yonetimi, muhasebe/finans kayitlarinin tutulmasi ve musteri memnuniyetinin saglanmasi temel amaclardir.',
          'Dolandiriciligi onleme, bilgi guvenligi, sistem suistimallerinin tespiti ve hukuki yukumluluklerin yerine getirilmesi de isleme amaclari arasindadir.'
        ]
      },
      {
        heading: 'Hukuki Sebepler',
        paragraphs: [
          'Veriler; sozlesmenin kurulmasi veya ifasi, hukuki yukumluluklerin yerine getirilmesi, mesru menfaat ve acik riza hukuki sebepleriyle islenebilir.',
          'Acik riza gerektiren ozel senaryolarda ilgili kisiye acik secim sunulur ve riza tercihi kayit altina alinir.'
        ]
      },
      {
        heading: 'Aktarim Yapilan Alici Gruplari',
        paragraphs: [
          'Kisisel veriler; odeme kuruluslari, kargo/lojistik firmalari, teknik altyapi saglayicilari, bagimsiz denetim ve mali musavirlik partnerleri ile yetkili kamu kurumlarina aktarilabilir.',
          'Aktarimlar yalnizca isleme amaci ile sinirli, olculu ve mevzuata uygun sekilde gerceklestirilir.'
        ]
      },
      {
        heading: 'Saklama Sureleri',
        paragraphs: [
          'Kisisel veriler, ilgili mevzuatta ongorulen sureler ve isleme amacinin gerektirdigi zorunlu sure boyunca saklanir.',
          'Saklama suresi dolan veriler periyodik imha surecleri ile silinir, yok edilir veya anonimlestirilir.'
        ]
      },
      {
        heading: 'Ilgili Kisi Haklari',
        paragraphs: [
          'KVKK madde 11 kapsaminda ilgili kisi, veri sorumlusuna basvurarak haklarini kullanabilir.',
          `Basvurularinizi ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} veya ${PLACEHOLDER_COMPANY_PROFILE.kepEmail} uzerinden iletebilirsiniz.`
        ],
        bullets: [
          'Veri islenip islenmedigini ogrenme ve bilgi talep etme.',
          'Isleme amacini ve aktarim alicilarini ogrenme.',
          'Eksik/yanlis verilerin duzeltilmesini isteme.',
          'Kanuni sartlar dahilinde silme/yok etme talep etme.',
          'Kanuna aykiri isleme nedeniyle zararin giderilmesini isteme.'
        ]
      },
      {
        heading: 'Basvuru Usulu ve Cevaplama Suresi',
        paragraphs: [
          'Basvurular, kimlik dogrulayici bilgi ve belgelerle birlikte yazili veya Kurulca belirlenen yontemlerle iletilmelidir.',
          'Talepler, niteligine gore en kisa surede ve en gec mevzuatta belirtilen sure icinde sonuclandirilir.'
        ]
      }
    ]
  },
  cookiePolicy: {
    key: 'cookiePolicy',
    slug: LEGAL_PAGE_SLUGS.cookiePolicy,
    title: 'Cerez Politikasi',
    summary:
      'Sitemizde kullanilan cerez turleri, hukuki dayanaklari ve tercih yonetim mekanizmalari bu politika ile aciklanir.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Cerez Nedir?',
        paragraphs: [
          'Cerezler, ziyaret ettiginiz internet siteleri tarafindan tarayicinizda saklanan kucuk metin dosyalaridir.',
          'Cerezler sayesinde oturum devamliligi saglanir, tercih hatirlanir ve hizmet kalitesi olcumlenebilir.'
        ]
      },
      {
        heading: 'Kullandigimiz Cerez Kategorileri',
        paragraphs: ['Islevsel ihtiyac ve kullanici tercihine gore asagidaki cerez kategorileri kullanilabilir.'],
        bullets: [
          'Zorunlu cerezler: guvenli giris, sepet, odeme ve temel site fonksiyonlari icin gereklidir.',
          'Islevsel cerezler: dil/bolge gibi tercihlerin hatirlanmasini saglar.',
          'Analitik cerezler: trafik, performans ve sayfa kullanim olcumleri yapar.',
          'Pazarlama cerezleri: ilgi alanina gore kampanya ve reklam icerigi gostermek icin kullanilabilir.'
        ]
      },
      {
        heading: 'Hukuki Dayanak ve Acik Riza',
        paragraphs: [
          'Zorunlu cerezler mesru menfaat ve hizmetin ifasi kapsaminda kullanilir.',
          'Zorunlu olmayan cerezler, acik rizaniz alinmadan aktif edilmez; tercihleriniz dilediginiz zaman guncellenebilir.'
        ]
      },
      {
        heading: 'Tercihlerin Yonetimi',
        paragraphs: [
          'Cerez tercihlerinizi banner uzerinden Tumunu Kabul Et, Tumunu Reddet veya Tercihleri Yonet secenekleri ile belirleyebilirsiniz.',
          'Site alt bilgisindeki Cerez Ayarlari baglantisindan tercihleriniz sonradan yeniden acilabilir.'
        ]
      },
      {
        heading: 'Ucuncu Taraf Cerezler',
        paragraphs: [
          'Odeme, analiz, reklam ve performans servisleri kapsaminda ucuncu taraf cerezler kullanilabilir.',
          'Ucuncu taraf servisler kendi gizlilik politikalarina tabi olup veri isleme surecleri ilgili saglayicinin sorumlulugundadir.'
        ]
      },
      {
        heading: 'Saklama Sureleri ve Guncelleme',
        paragraphs: [
          'Cerezler oturumluk veya kalici surelerle saklanabilir; saklama suresi cerezin amacina ve teknik gereksinimlerine gore degisir.',
          'Politika guncellemeleri bu sayfada yayinlanir; onemli degisikliklerde kullanicilar banner veya ek bilgilendirmelerle haberdar edilir.'
        ]
      }
    ]
  },
  membershipTerms: {
    key: 'membershipTerms',
    slug: LEGAL_PAGE_SLUGS.membershipTerms,
    title: 'Uyelik ve Kullanim Kosullari',
    summary:
      'Platformun kullanimi, uyelik hesap yonetimi, yasak faaliyetler ve taraf sorumluluklari bu kosullar ile duzenlenir.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_TR,
      {
        heading: 'Kapsam ve Kabul',
        paragraphs: [
          'Siteye uye olan veya uyelik olmaksizin hizmetlerden yararlanan her kullanici bu metindeki kosullari kabul etmis sayilir.',
          'Satici, yasal yukumlulukler ve operasyonel ihtiyaclar dogrultusunda kosullari guncelleyebilir; guncel metin yayinlandigi andan itibaren yururluge girer.'
        ]
      },
      {
        heading: 'Uyelik Hesabi ve Bilgi Dogrulugu',
        paragraphs: [
          'Kullanicinin paylastigi ad, soyad, iletisim ve adres bilgileri dogru ve guncel olmalidir.',
          'Hesap guvenliginin saglanmasi, sifrenin korunmasi ve hesaptan yapilan islemlerin takibi kullanicinin sorumlulugundadir.'
        ]
      },
      {
        heading: 'Kullanim Kurallari',
        paragraphs: [
          'Platform yalnizca hukuka uygun amaclarla kullanilabilir. Sistem guvenligini tehdit eden, diger kullanicilari zarara ugratan veya haksiz menfaat saglayan islem ve girisimler yasaktir.',
          'Kullanici, olusturdugu icerik ve paylastigi bilgilerin hukuka uygunlugundan dogrudan sorumludur.'
        ],
        bullets: [
          'Sahte hesap acma veya baskasi adina islem yapma yasaktir.',
          'Robot, scraper, bot ve benzeri yontemlerle sistem kaynaklarini asiri tuketme yasaktir.',
          'Fiyat/indirim aciklarini kotuye kullanma girisimleri siparis iptaline konu olabilir.'
        ]
      },
      {
        heading: 'Siparis, Stok ve Fiyat Politikasi',
        paragraphs: [
          'Urun fiyati, stok durumu ve teslimat bilgileri dinamik olarak guncellenebilir. Sepete eklenen urunun fiyati, siparis anindaki guncel deger uzerinden kesinlesir.',
          'Acik yazim hatasi, teknik ariza veya tedarik kaynakli stok tutarsizligi hallerinde siparis teyidi yeniden degerlendirilebilir.'
        ]
      },
      {
        heading: 'Fikri Mulkiyet ve Icerik Kullanimi',
        paragraphs: [
          'Sitedeki marka, logo, metin, gorsel, yazilim ve tasarim unsurlarinin tum fikri mulkiyet haklari hak sahiplerine aittir.',
          'Onceden yazili izin olmaksizin iceriklerin kopyalanmasi, cogaltilmasi, dagitilmasi veya ticari kullanimi yasaktir.'
        ]
      },
      {
        heading: 'Hesap Kisitlama, Askiya Alma ve Fesih',
        paragraphs: [
          'Kosullara aykiri davranis, supheli islem, guvenlik riski veya hukuki yukumluluk doguran hallerde hesap gecici ya da kalici olarak kisitlanabilir.',
          `Uyelik sonlandirma talepleri ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} adresine iletilebilir.`
        ]
      },
      {
        heading: 'Sorumluluk Siniri ve Uyusmazlik',
        paragraphs: [
          'Mucbir sebep, ucuncu taraf servis kesintisi, internet altyapisi sorunlari gibi satici kontrolu disi hallerde dogabilecek dolayli zararlardan satici sorumlu tutulamaz.',
          'Uyusmazliklarda Turk hukuku uygulanir; ilgili yilin parasal sinirlari dahilinde Tuketici Hakem Heyeti ve Tuketici Mahkemeleri yetkilidir.'
        ]
      }
    ]
  }
}

const LEGAL_DOCUMENTS_EN: Record<LegalPageKey, LegalDocument> = {
  distanceSales: {
    key: 'distanceSales',
    slug: LEGAL_PAGE_SLUGS.distanceSales,
    title: 'Distance Sales Agreement',
    summary:
      'This agreement governs online sales and defines the rights and obligations of the seller and the buyer under applicable consumer legislation.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'Legal Basis and Scope',
        paragraphs: [
          'This agreement applies to electronically established sales contracts under Turkish Consumer Law No. 6502 and related distance selling regulations.',
          'It covers orders placed through the website, mobile app and any marketplace channel operated by the seller.'
        ]
      },
      {
        heading: 'Parties',
        paragraphs: [
          `Seller: ${PLACEHOLDER_COMPANY_PROFILE.legalName}`,
          `MERSIS: ${PLACEHOLDER_COMPANY_PROFILE.mersisNo} | Tax Office/No: ${PLACEHOLDER_COMPANY_PROFILE.taxOffice} / ${PLACEHOLDER_COMPANY_PROFILE.taxNo}`,
          `Contact: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          'Buyer: the customer whose identity and delivery details are declared at checkout.'
        ]
      },
      {
        heading: 'Contract Formation and Order Flow',
        paragraphs: [
          'The buyer reviews pre-information disclosures, confirms the agreement and completes payment to create the order.',
          'The contract becomes effective once payment authorization is successful and the order confirmation is sent to the buyer.'
        ],
        bullets: [
          'Product details, unit price, shipping fee and total amount are shown before payment.',
          'Obvious pricing or stock mismatches caused by technical errors may require order re-validation.',
          'Order logs are retained according to legal retention obligations.'
        ]
      },
      {
        heading: 'Pricing, Payment and Invoice',
        paragraphs: [
          'Product pricing and tax display are provided on product and checkout screens. Promotions and coupons are valid only under active campaign rules.',
          'Payment is processed by secure payment providers. Sensitive card data is not stored in merchant systems.',
          'Invoices are issued electronically in line with tax legislation.'
        ]
      },
      {
        heading: 'Delivery and Performance',
        paragraphs: [
          'Orders are typically dispatched within 1-3 business days, and express options target next-business-day dispatch where available.',
          'Delivery is made to the address declared by the buyer, and package integrity should be verified upon receipt.'
        ],
        bullets: [
          'Public holidays, force majeure and regional carrier limitations may affect lead times.',
          'If fulfillment becomes impossible, the buyer is informed and collected amounts are refunded within legal deadlines.',
          'Split shipments may be used for multi-item orders when required operationally.'
        ]
      },
      {
        heading: 'Withdrawal Right, Returns and Exceptions',
        paragraphs: [
          `The buyer may exercise the right of withdrawal within ${POLICY_DEFAULTS.cancellationWindowDays} days after delivery, through durable communication channels.`,
          'Legal exceptions may apply for customized goods, installed products or items not suitable for return due to hygiene or technical reasons.'
        ],
        bullets: [
          'Returned items should be complete and suitable for resale unless mandatory legal exceptions apply.',
          'Vehicle-specific custom supply items may be excluded from standard return scope where permitted by law.',
          'Return shipping cost responsibility is presented in the pre-information stage.'
        ]
      },
      {
        heading: 'Defective Goods and Warranty',
        paragraphs: [
          'If a product is alleged defective, the buyer should notify the seller without undue delay and share supporting evidence.',
          'Resolution options are evaluated under legal warranty rules, including repair, replacement, price reduction or contract cancellation.'
        ]
      },
      {
        heading: 'Force Majeure and Dispute Resolution',
        paragraphs: [
          'Events beyond reasonable control (natural disaster, pandemic, war, infrastructure outages) may delay contractual performance.',
          'Consumer Arbitration Committees and Consumer Courts are competent authorities within statutory monetary thresholds.'
        ]
      }
    ]
  },
  preInformation: {
    key: 'preInformation',
    slug: LEGAL_PAGE_SLUGS.preInformation,
    title: 'Pre-Information Form',
    summary:
      'This form provides mandatory pre-contract disclosures, including pricing, payment, delivery and withdrawal information.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'Seller Identity and Contact',
        paragraphs: [
          `Legal Name: ${PLACEHOLDER_COMPANY_PROFILE.legalName}`,
          `MERSIS: ${PLACEHOLDER_COMPANY_PROFILE.mersisNo} | Trade Registry No: ${PLACEHOLDER_COMPANY_PROFILE.tradeRegistryNo}`,
          `Tax Office/No: ${PLACEHOLDER_COMPANY_PROFILE.taxOffice} / ${PLACEHOLDER_COMPANY_PROFILE.taxNo}`,
          `Contact: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          `Open Address: ${PLACEHOLDER_COMPANY_PROFILE.openAddress}`
        ]
      },
      {
        heading: 'Main Characteristics and Total Price',
        paragraphs: [
          'Technical properties, quantity and unit price of ordered items are shown before the order is finalized.',
          'Subtotal, shipping fee, discounts and payable total are displayed transparently at checkout.'
        ],
        bullets: [
          'Tax display is presented according to legal requirements.',
          'Campaign terms may vary by stock, period and channel.',
          'Supplier or operational updates may affect final pricing before order confirmation.'
        ]
      },
      {
        heading: 'Payment Methods and Security',
        paragraphs: [
          'Available payment options may include card payment, installments, bank transfer and cash on delivery depending on channel and eligibility.',
          'Payments are processed by certified payment service providers and card data is not retained in merchant systems.'
        ]
      },
      {
        heading: 'Delivery Details',
        paragraphs: [
          'Standard delivery target is 1-3 business days; express delivery target is next business day where available.',
          `Free shipping may be offered on eligible campaigns for baskets above ${POLICY_DEFAULTS.freeShippingThresholdTry} TRY.`
        ],
        bullets: [
          'Lead time is calculated after payment approval.',
          'Incorrect or incomplete address declarations may delay delivery.',
          'Updated delivery timelines are communicated when logistics disruptions occur.'
        ]
      },
      {
        heading: 'Withdrawal and Return Information',
        paragraphs: [
          `The buyer has a ${POLICY_DEFAULTS.cancellationWindowDays}-day withdrawal right after delivery, subject to legal exceptions.`,
          `Return workflow is generally completed within an operational window of up to ${POLICY_DEFAULTS.returnWindowDays} days after request approval.`
        ],
        bullets: [
          'Return request should include order number and reason for return.',
          'Items that are opened, installed, damaged or hygiene-sensitive may be excluded under legal rules.',
          'Refunds are initiated to the original payment instrument within statutory timelines.'
        ]
      },
      {
        heading: 'Complaints and Official Applications',
        paragraphs: [
          `Customer support: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          `Registered e-notice (KEP): ${PLACEHOLDER_COMPANY_PROFILE.kepEmail}`,
          'Consumers may apply to competent arbitration committees or consumer courts under applicable monetary thresholds.'
        ]
      },
      {
        heading: 'Buyer Confirmation',
        paragraphs: [
          'By completing the checkout, the buyer confirms that this pre-information form has been read and understood electronically before the contract is formed.',
          'The seller stores disclosure and consent logs in line with legal record-keeping obligations.'
        ]
      }
    ]
  },
  privacyPolicy: {
    key: 'privacyPolicy',
    slug: LEGAL_PAGE_SLUGS.privacyPolicy,
    title: 'Privacy Policy',
    summary:
      'This policy explains how personal data is collected, processed, shared, retained and how data subject rights can be exercised.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'Scope and Data Controller',
        paragraphs: [
          `${PLACEHOLDER_COMPANY_PROFILE.legalName} acts as the data controller for website and related services.`,
          'The policy applies to visitors, registered users, customers, suppliers and anyone sharing personal data through service channels.'
        ]
      },
      {
        heading: 'Categories of Data Processed',
        paragraphs: ['Depending on service use, the following categories may be processed.'],
        bullets: [
          'Identity details: name, surname, title.',
          'Contact details: email, phone, delivery and billing address.',
          'Customer transaction data: order, return and support history.',
          'Security logs: IP address, session events, technical diagnostics.',
          'Request records: call center and contact form communications.'
        ]
      },
      {
        heading: 'Collection Methods and Purposes',
        paragraphs: [
          'Data may be collected through account forms, checkout flows, cookies, support channels and technical logs.',
          'Primary purposes include order fulfillment, payment and delivery operations, fraud prevention, legal compliance and service improvement.'
        ]
      },
      {
        heading: 'Legal Grounds',
        paragraphs: [
          'Processing may rely on contract performance, legal obligations, legitimate interests or explicit consent depending on the context.',
          'Where consent is required, users are given clear opt-in/opt-out choices and can change choices later.'
        ]
      },
      {
        heading: 'Data Transfers',
        paragraphs: [
          'Data may be shared with payment providers, carriers, infrastructure vendors, audit/accounting partners and authorized public institutions when necessary.',
          'Any international transfer is managed under applicable data protection safeguards and legal mechanisms.'
        ]
      },
      {
        heading: 'Retention and Deletion',
        paragraphs: [
          'Data is retained only for required legal and operational periods, then deleted, destroyed or anonymized according to retention rules.',
          'Retention schedules are periodically reviewed and enforced through internal governance.'
        ]
      },
      {
        heading: 'Security Measures',
        paragraphs: [
          'Administrative and technical safeguards are applied to reduce unauthorized access, alteration, loss or disclosure risks.',
          'Access controls, monitoring and incident response processes are implemented to protect system integrity.'
        ]
      },
      {
        heading: 'Your Rights and Contact',
        paragraphs: [
          'You may exercise data subject rights by contacting the data controller through the channels below.',
          `Contact: ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} | KEP: ${PLACEHOLDER_COMPANY_PROFILE.kepEmail}`
        ],
        bullets: [
          'Learn whether your data is processed and request related details.',
          'Request correction of inaccurate or incomplete data.',
          'Request deletion/destruction under legal conditions.',
          'Object to unlawful processing and claim compensation where applicable.'
        ]
      }
    ]
  },
  deliveryAndReturns: {
    key: 'deliveryAndReturns',
    slug: LEGAL_PAGE_SLUGS.deliveryAndReturns,
    title: 'Delivery and Return Policy',
    summary:
      'This policy describes dispatch, delivery, return eligibility, rejection reasons and refund workflows in a step-by-step format.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'Order Preparation and Dispatch',
        paragraphs: [
          'After payment approval, orders are picked, verified and packed before handover to contracted logistics partners.',
          'Split shipment may be used for multi-item orders when stock location or package constraints require separate dispatch.'
        ]
      },
      {
        heading: 'Delivery Timelines and Coverage',
        paragraphs: [
          'Standard delivery target is 1-3 business days; express delivery target is next business day where available.',
          `Eligible campaigns may offer free shipping for baskets above ${POLICY_DEFAULTS.freeShippingThresholdTry} TRY.`
        ],
        bullets: [
          'Public holidays and force majeure conditions may affect timelines.',
          'Incorrect address details may cause delay or return-to-sender events.',
          'Tracking updates are provided through order pages and notifications.'
        ]
      },
      {
        heading: 'Inspection at Delivery',
        paragraphs: [
          'Customers should inspect package integrity, quantity and visible defects upon handover.',
          'When package damage is observed, a courier damage report should be requested at delivery time.'
        ]
      },
      {
        heading: 'Return Eligibility',
        paragraphs: [
          `Return requests should be submitted within ${POLICY_DEFAULTS.returnWindowDays} days from delivery.`,
          'Items are expected to be complete, unused and suitable for resale unless legal exceptions apply.'
        ],
        bullets: [
          'Customized, installed or hygiene-sensitive items may be excluded under law.',
          'Damaged, incomplete or heavily used items may be rejected after inspection.',
          'Return acceptance is subject to technical and operational verification.'
        ]
      },
      {
        heading: 'Withdrawal-Based Return Steps',
        paragraphs: [
          `Customers may start withdrawal returns within ${POLICY_DEFAULTS.cancellationWindowDays} days from delivery via support channels.`,
          'Approved requests receive return instructions and shipping reference details before warehouse intake.'
        ],
        bullets: [
          'Include order number and return reason in the request.',
          'Keep shipping handover receipt until process completion.',
          'Status updates are shared by email or account panel.'
        ]
      },
      {
        heading: 'Refund Timeline',
        paragraphs: [
          'Approved refunds are initiated to the original payment method within legal deadlines.',
          'Final posting date may vary due to card issuer or banking processing times outside seller control.'
        ]
      },
      {
        heading: 'Exchange and Support',
        paragraphs: [
          'Where operationally possible, exchange may be offered based on stock availability and product condition.',
          `Support: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone} - ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`
        ]
      }
    ]
  },
  contact: {
    key: 'contact',
    slug: LEGAL_PAGE_SLUGS.contact,
    title: 'Contact',
    summary:
      'Customer support channels, registered address, corporate identity details and official notice channels are listed below.',
    lastUpdated: '2026-03-12',
    sections: [
      {
        heading: 'Customer Support',
        paragraphs: [
          `Phone: ${PLACEHOLDER_COMPANY_PROFILE.supportPhone}`,
          `WhatsApp Support: ${PLACEHOLDER_COMPANY_PROFILE.supportWhatsapp}`,
          `Email: ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}`,
          `Working Hours: ${PLACEHOLDER_COMPANY_PROFILE.workingHours}`
        ],
        bullets: [
          'Order, payment, delivery and return inquiries are handled through this channel.',
          'High-volume periods may extend response times.',
          'Please include your order number for faster resolution.'
        ]
      },
      {
        heading: 'Registered Address and Return Point',
        paragraphs: [
          `Head Office: ${PLACEHOLDER_COMPANY_PROFILE.openAddress}`,
          'The return address is the same as the registered head office address.'
        ]
      },
      {
        heading: 'Corporate Identity Details',
        paragraphs: [
          `Legal Name: ${PLACEHOLDER_COMPANY_PROFILE.legalName}`,
          `Trade Registry No: ${PLACEHOLDER_COMPANY_PROFILE.tradeRegistryNo}`,
          `MERSIS No: ${PLACEHOLDER_COMPANY_PROFILE.mersisNo}`,
          `Tax Office/No: ${PLACEHOLDER_COMPANY_PROFILE.taxOffice} / ${PLACEHOLDER_COMPANY_PROFILE.taxNo}`
        ]
      },
      {
        heading: 'Official Notice and Data Requests',
        paragraphs: [
          `KEP: ${PLACEHOLDER_COMPANY_PROFILE.kepEmail}`,
          'Official notices and data protection requests can be directed through registered communication channels.'
        ]
      }
    ]
  },
  kvkkDisclosure: {
    key: 'kvkkDisclosure',
    slug: LEGAL_PAGE_SLUGS.kvkkDisclosure,
    title: 'KVKK Disclosure Notice',
    summary:
      'This disclosure explains data processing under Turkish Personal Data Protection Law (KVKK No. 6698), including legal grounds and data subject rights.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'Data Controller Identity',
        paragraphs: [
          `${PLACEHOLDER_COMPANY_PROFILE.legalName} is the data controller under KVKK.`,
          `Contact: ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} | ${PLACEHOLDER_COMPANY_PROFILE.supportPhone}`
        ]
      },
      {
        heading: 'Categories of Personal Data',
        paragraphs: ['The following data groups may be processed where relevant to service delivery.'],
        bullets: [
          'Identity and contact information.',
          'Order, return and customer transaction records.',
          'Payment and financial operation records (excluding full card data).',
          'Security logs, IP and technical usage records.',
          'Support request and complaint records.'
        ]
      },
      {
        heading: 'Processing Purposes',
        paragraphs: [
          'Main purposes include order fulfillment, payment handling, logistics operations, return management and customer support.',
          'Additional purposes include fraud prevention, information security and compliance with legal obligations.'
        ]
      },
      {
        heading: 'Legal Grounds',
        paragraphs: [
          'Processing may rely on contract performance, compliance obligations, legitimate interests and explicit consent where necessary.',
          'Consent-based processing is managed with clear preference controls and revocation options.'
        ]
      },
      {
        heading: 'Transfers to Third Parties',
        paragraphs: [
          'Data may be transferred to payment institutions, logistics partners, infrastructure vendors, advisors and authorized public bodies as required.',
          'Transfers are limited to purpose-specific, proportionate and lawful scopes.'
        ]
      },
      {
        heading: 'Retention Periods',
        paragraphs: [
          'Data is retained for legally mandated periods and operational necessities, then deleted, destroyed or anonymized.',
          'Retention schedules are reviewed periodically within data governance controls.'
        ]
      },
      {
        heading: 'Data Subject Rights',
        paragraphs: [
          'Under Article 11 of KVKK, data subjects may submit requests to the data controller.',
          `Requests can be sent to ${PLACEHOLDER_COMPANY_PROFILE.supportEmail} or via KEP ${PLACEHOLDER_COMPANY_PROFILE.kepEmail}.`
        ],
        bullets: [
          'Learn whether personal data is processed.',
          'Request information, correction and completion.',
          'Request deletion/destruction under legal conditions.',
          'Object to unlawful processing and seek compensation where applicable.'
        ]
      },
      {
        heading: 'Application Method and Response Period',
        paragraphs: [
          'Applications should include identity-verification details and the relevant request scope.',
          'Requests are handled as soon as possible and within legal response deadlines.'
        ]
      }
    ]
  },
  cookiePolicy: {
    key: 'cookiePolicy',
    slug: LEGAL_PAGE_SLUGS.cookiePolicy,
    title: 'Cookie Policy',
    summary:
      'This policy explains cookie categories, legal basis, consent controls and preference management tools used on the platform.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'What Is a Cookie?',
        paragraphs: [
          'Cookies are small text files stored in your browser to support website functionality and user experience.',
          'They can preserve session continuity, remember preferences and enable measurement insights.'
        ]
      },
      {
        heading: 'Cookie Categories We Use',
        paragraphs: ['Depending on consent and functionality needs, the following categories may be used.'],
        bullets: [
          'Strictly necessary cookies: required for login, cart and checkout continuity.',
          'Functional cookies: remember language and interface preferences.',
          'Analytics cookies: measure traffic and service performance.',
          'Marketing cookies: support interest-based campaigns and content targeting.'
        ]
      },
      {
        heading: 'Legal Basis and Consent',
        paragraphs: [
          'Necessary cookies may rely on legitimate interest or service necessity.',
          'Non-essential cookies are activated only after valid consent is captured and can be changed later.'
        ]
      },
      {
        heading: 'Preference Management',
        paragraphs: [
          'Cookie preferences can be set through banner actions: Allow All, Reject All or Manage Preferences.',
          'The Cookie Settings link in the footer can reopen preference controls at any time.'
        ]
      },
      {
        heading: 'Third-Party Cookies',
        paragraphs: [
          'Third-party cookies may be used for payment, analytics, advertising and embedded services.',
          'Third-party services process data under their own policies and compliance obligations.'
        ]
      },
      {
        heading: 'Storage Duration and Policy Updates',
        paragraphs: [
          'Cookies may be session-based or persistent depending on purpose and technical need.',
          'Policy updates are published on this page, and major changes may also be communicated through banner notices.'
        ]
      }
    ]
  },
  membershipTerms: {
    key: 'membershipTerms',
    slug: LEGAL_PAGE_SLUGS.membershipTerms,
    title: 'Membership and Terms of Use',
    summary:
      'These terms regulate account management, platform use rules, prohibited conduct and liability boundaries.',
    lastUpdated: '2026-03-12',
    sections: [
      TEMPLATE_NOTICE_EN,
      {
        heading: 'Scope and Acceptance',
        paragraphs: [
          'Any user accessing or using the platform, with or without registration, is deemed to accept these terms.',
          'The seller may update terms due to legal or operational requirements; updated text becomes effective upon publication.'
        ]
      },
      {
        heading: 'Account Registration and Accuracy',
        paragraphs: [
          'Users are responsible for providing accurate and current identity and contact details.',
          'Account credentials must be protected by the user, and all account activities are the user responsibility unless proven otherwise by law.'
        ]
      },
      {
        heading: 'Platform Use Rules',
        paragraphs: [
          'The platform may only be used for lawful purposes and in a manner that does not disrupt security, integrity or other users rights.',
          'Users are directly responsible for legality and accuracy of content or information they submit.'
        ],
        bullets: [
          'No fake identity or unauthorized account usage.',
          'No scraping, bot traffic or abuse of system resources.',
          'No exploitation of obvious pricing or technical vulnerabilities.'
        ]
      },
      {
        heading: 'Orders, Stock and Pricing',
        paragraphs: [
          'Stock, campaign and price data may change dynamically. Final price is determined at confirmed checkout.',
          'Orders may be re-validated in case of obvious technical pricing errors or supplier stock conflicts.'
        ]
      },
      {
        heading: 'Intellectual Property',
        paragraphs: [
          'All trademarks, logos, content, software and design assets are protected and belong to rights holders.',
          'Copying, reproducing or commercial reuse without prior written permission is prohibited.'
        ]
      },
      {
        heading: 'Account Restriction and Termination',
        paragraphs: [
          'Accounts may be suspended or terminated for policy violations, fraud indicators, abuse or legal compliance requirements.',
          `Termination requests can be sent to ${PLACEHOLDER_COMPANY_PROFILE.supportEmail}.`
        ]
      },
      {
        heading: 'Liability and Disputes',
        paragraphs: [
          'The seller is not liable for indirect losses arising from force majeure, third-party service outages or external infrastructure issues beyond reasonable control.',
          'Turkish law applies; competent consumer arbitration committees and consumer courts have jurisdiction within legal thresholds.'
        ]
      }
    ]
  }
}

const LEGAL_DOCUMENTS: Record<LegalLocale, Record<LegalPageKey, LegalDocument>> = {
  tr: LEGAL_DOCUMENTS_TR,
  en: LEGAL_DOCUMENTS_EN
}

export function resolveLegalLocale(locale: string): LegalLocale {
  return locale === 'en' ? 'en' : 'tr'
}

export function getLegalDocument(locale: string, key: LegalPageKey): LegalDocument {
  const resolvedLocale = resolveLegalLocale(locale)
  return LEGAL_DOCUMENTS[resolvedLocale][key]
}

export function getLegalHref(key: LegalPageKey): string {
  return `/${LEGAL_PAGE_SLUGS[key]}`
}

export function getLegalDocuments(locale: string): LegalDocument[] {
  const resolvedLocale = resolveLegalLocale(locale)
  return Object.values(LEGAL_DOCUMENTS[resolvedLocale])
}
