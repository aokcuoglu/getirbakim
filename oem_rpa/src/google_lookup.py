"""
Google AI Modu tarayici otomasyonu (Playwright).

DIKKAT - kirilgan halka:
  * Google AI Modu'nun resmi API'si yoktur.
  * Otomasyon CAPTCHA / bot dogrulamasina takilabilir.
  * Google arayuzu degisirse asagidaki secicilerin guncellenmesi gerekir.
Bu yuzden headless=false ile calistirip ilk CAPTCHA'yi elle cozmen,
ve sorgular arasi gecikme birakman onerilir.
"""

import random
import re
import time
import urllib.parse

from playwright.sync_api import sync_playwright

# Sayfadaki "oem no:" etiketi sayisi. Prompt yankisi 1 tane getirir; CEVAP
# gelince 2 olur. Yani >=2 -> cevap hazir demektir.
_OEM_LABEL_RE = re.compile(r"(?im)^\s*oem\s*(?:no|numaras[ıi])?\s*:")

# Batch prompt: TABLO iste. (Canli test: '### bloklu' batch jenerik cop donduruyor;
# TABLO formati Google'i her satiri ayri arastirmaya zorluyor -> GERCEK OEM geliyor.)
# Tablo innerText'te TAB-ayrik gelir: "kod\tparça adı\toem no".
_DEFAULT_BATCH_TMPL = (
    "Aşağıdaki {n} parça için markdown tablo döndür. Sütunlar: kod | parça adı | "
    "oem no. parça adı = e-ticaret için açıklayıcı SEO başlığı (marka, parça tipi, "
    "uyumlu araç modelleri, motor, malzeme). oem no = virgülle ayrılmış GERÇEK OEM "
    "MARKA KOD listesi (parçanın kendi kodunu YAZMA; veri yoksa boş bırak). Sadece "
    "tabloyu ver, başka açıklama ekleme.\n\nParçalar:\n{parts}"
)


def _table_row_count(text: str) -> int:
    """Tab-ayrik + rakam iceren satir sayisi = tablo veri satiri sayisi (baslik haric)."""
    n = 0
    for ln in (text or "").splitlines():
        if "\t" in ln and re.search(r"\d", ln):
            n += 1
    return n


class CaptchaBlocked(Exception):
    """Denetimsiz modda CAPTCHA cooldown'larina ragmen asilamadi."""


class GoogleAIMode:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._pw = None
        self._ctx = None
        self._page = None
        self._chat_started = False   # conversation_mode: ilk soru soruldu mu
        self._chat_turns = 0         # mevcut konusmadaki takip sorusu sayisi

    def __enter__(self):
        self._pw = sync_playwright().start()
        # Kalici profil: oturum + cerezler saklanir, CAPTCHA'yi bir kez cozersin.
        launch_kwargs = dict(
            user_data_dir=self.cfg.get("user_data_dir", "./.chrome_profile"),
            headless=self.cfg.get("headless", False),
            locale="tr-TR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        # channel="chrome" -> Playwright'in paketledigi "Chrome for Testing"
        # yerine sistemdeki GERCEK Google Chrome'u kullanir (daha standart
        # parmak izi -> daha az CAPTCHA). Chrome kurulu degilse config'den kaldir.
        channel = self.cfg.get("channel")
        if channel:
            launch_kwargs["channel"] = channel
        self._ctx = self._pw.chromium.launch_persistent_context(**launch_kwargs)
        self._page = self._ctx.new_page() if not self._ctx.pages else self._ctx.pages[0]
        return self

    def __exit__(self, *exc):
        # Ctrl+C terminalde TUM surec grubuna gider: Chrome ve Playwright'in
        # node surucusu da SIGINT alip oldugu icin buradaki close/stop
        # "Connection closed while reading from the driver" ile patlar.
        # Kapatma hatalarini yutariz; yoksa asil KeyboardInterrupt bunun
        # altinda kaybolup ekrana koca bir traceback dokuluyor.
        # BaseException: teardown sirasinda gelen ikinci Ctrl+C de yutulur.
        try:
            if self._ctx:
                self._ctx.close()
        except BaseException:
            pass
        try:
            if self._pw:
                self._pw.stop()
        except BaseException:
            pass
        return False   # asil istisna (KeyboardInterrupt dahil) yukari gitsin

    def _sleep(self):
        lo = self.cfg.get("min_delay_sec", 8)
        hi = self.cfg.get("max_delay_sec", 20)
        time.sleep(random.uniform(lo, hi))

    def ask(self, brand: str, part: str):
        """Bir parca icin Google AI Modu'na sorar. Iki mod:

        * conversation_mode=false (varsayilan): her urun icin YENI arama
          (goto ?q=). Saglam ama daha cok CAPTCHA.
        * conversation_mode=true (deneysel): ilk soru yeni aramayla konusmayi
          baslatir; sonrakiler AYNI konusmaya takip sorusu olarak yazilir.
          Amac: daha az CAPTCHA. Parser SON cevabi aldigi icin birikmis
          konusmadan en yeni cevap ayristirilir; yeni cevap gelmediyse (sayac
          artmadiysa) urun ATLANIR (eski cevap yanlislikla yazilmaz).
        """
        conv = self.cfg.get("conversation_mode", False)
        reset_every = int(self.cfg.get("conversation_reset_every", 15))

        # Uzun konusma Google tarafinda bozuluyor (yanit uretemiyor, kutu
        # kayboluyor). Bu yuzden her `reset_every` takip sorusundan sonra
        # konusmayi sifirlayip YENI chat baslatiriz.
        # NOT: sayac bookkeeping'i _ask_fresh/_ask_followup icinde yapilir;
        # boylece takip sorusu ortada yeni aramaya duserse sayac da sifirlanir
        # (eskiden burada kosulsuz artiyordu -> sifirlama yanlis anda geliyordu).
        if conv and self._chat_started and (reset_every <= 0
                                            or self._chat_turns < reset_every):
            return self._ask_followup(brand, part)

        if conv and self._chat_started and reset_every > 0:
            print(f"    [chat] {self._chat_turns} takip sorusu sonrasi yeni konusma baslatiliyor")
        return self._ask_fresh(brand, part)

    def _restart_chat(self, brand: str, part: str, reason: str):
        """Konusma bozuldu -> sifirla ve bu urunu YENI aramayla sor.

        Eskiden bozuk konusmada bos ("", []) donuluyordu: urun kaybediliyor,
        konusma bozuk kaldigi icin SONRAKI her urun de bos donuyordu
        (log'daki 'gonderilebilir icerik yok' zinciri budur).
        """
        print(f"    [chat] {reason} -> konusma sifirlaniyor, yeni arama yapiliyor")
        self._chat_started = False
        self._chat_turns = 0
        return self._ask_fresh(brand, part)

    def _ask_fresh(self, brand: str, part: str):
        query = self.cfg["query_template"].format(brand=brand, part=part)
        page = self._page
        timeout_ms = self.cfg.get("timeout_sec", 45) * 1000

        # AI Modu URL'i (udm=50 = AI Mode). Cok satirli/Turkce sorguyu tam
        # kodlamak icin quote_plus. Degisirse udm parametresini guncelle.
        url = "https://www.google.com/search?udm=50&q=" + urllib.parse.quote_plus(query)

        unattended = self.cfg.get("unattended", False)
        cooldown = int(self.cfg.get("captcha_cooldown_sec", 600))
        max_attempts = int(self.cfg.get("captcha_max_attempts", 3))

        from .parser import parse
        ai_error_retries = int(self.cfg.get("ai_error_retries", 2))
        limit = self.cfg.get("timeout_sec", 45)
        text = ""

        for ai_attempt in range(ai_error_retries + 1):
            # --- goto + CAPTCHA dongusu ---
            attempt = 0
            while True:
                page.goto(url, timeout=timeout_ms)
                if not self._looks_like_captcha(page):
                    break
                if not unattended:
                    # Denetimli mod: insan cozer.
                    input("\n[!] CAPTCHA / dogrulama gorunuyor. Tarayicida coz, "
                          "sonra ENTER'a bas...")
                    break
                # Denetimsiz (gece) mod: bekle-tekrar dene, gecmezse pes et.
                attempt += 1
                if attempt > max_attempts:
                    raise CaptchaBlocked(
                        f"{max_attempts} denemede CAPTCHA asilamadi (unattended)")
                w = min(cooldown * attempt, 3600)
                print(f"    [captcha] unattended: {w} sn bekleyip tekrar denenecek "
                      f"({attempt}/{max_attempts})")
                time.sleep(w)

            # --- cevabi bekle: gercek OEM gorunce YA DA hata metni cikinca dur ---
            start = time.time()
            while time.time() - start < limit:
                text = self._extract_answer(page)
                if parse(text).oems or self._is_ai_error(text):
                    break
                time.sleep(1.0)
            time.sleep(1.5)                     # akisin son tokenleri insin
            text = self._extract_answer(page)

            # OEM geldiyse ya da hata degilse cik. Google "yanit uretilemedi"
            # dediyse kisa bekleyip yeniden dene (gecici hatalari kurtarir).
            if parse(text).oems or not self._is_ai_error(text):
                break
            if ai_attempt < ai_error_retries:
                w = 8 + ai_attempt * 8
                print(f"    [ai-hata] Google yanit uretemedi, {w}s sonra tekrar "
                      f"({ai_attempt + 1}/{ai_error_retries})")
                time.sleep(w)

        sources = self._extract_sources(page)
        # Konusma modunda: bu taze arama yeni konusmayi baslatir. Google zaten
        # hata veriyorsa konusmayi baslatmis sayma (sonraki urun de taze sorsun).
        if self.cfg.get("conversation_mode", False):
            self._chat_started = not self._is_ai_error(text)
            self._chat_turns = 0
        self._sleep()
        return text, sources

    def _find_chat_input(self, page):
        """AI Modu 'Soru sorun' giris kutusunu bulur.

        Onay: canlida kutu -> <textarea placeholder="Soru sorun"> (form YOK,
        Enter JS ile sayfa-ici takip sorusu yapar). Once bilinen placeholder/aria
        (TR+EN), sonra yedek olarak EN ALTTAKI gorunur textarea/contenteditable
        (takip kutusu hep sayfanin altinda) secilir -> arayuz/dil degisse de bulur.
        """
        for sel in (
            'textarea[placeholder*="Soru" i]',
            'textarea[placeholder*="sorun" i]',
            'textarea[aria-label*="Soru" i]',
            'textarea[placeholder*="Ask" i]',
            'textarea[aria-label*="Ask" i]',
            'div[contenteditable="true"][aria-label*="Soru" i]',
            'div[contenteditable="true"][aria-label*="Ask" i]',
        ):
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    return el
            except Exception:
                continue
        # Yedek: en altta duran gorunur, yeterince genis textarea/contenteditable
        best, best_y = None, -1.0
        try:
            for el in page.query_selector_all('textarea, div[contenteditable="true"]'):
                try:
                    if not el.is_visible():
                        continue
                    box = el.bounding_box()
                    if not box or box["width"] < 120:
                        continue
                    if box["y"] > best_y:
                        best, best_y = el, box["y"]
                except Exception:
                    continue
        except Exception:
            pass
        return best

    def _ask_followup(self, brand: str, part: str):
        """Ayni konusmaya takip sorusu yazar. Kutu bulunamaz / soru gonderilemez /
        yeni cevap gelmezse konusmayi sifirlayip YENI aramaya (tam format) duser."""
        page = self._page
        # Takip sorulari uzun konusmada yavaslar; kendi (daha genis) limiti olsun.
        limit = self.cfg.get("followup_timeout_sec", self.cfg.get("timeout_sec", 45))

        fq = self.cfg.get(
            "conversation_followup_template", "{brand} {part}"
        ).format(brand=brand, part=part)

        # CAPTCHA konusma ortasinda cikarsa: taze aramaya dus (tam CAPTCHA mantigi orada)
        if self._looks_like_captcha(page):
            return self._restart_chat(brand, part, "CAPTCHA")

        prev = len(_OEM_LABEL_RE.findall(self._extract_answer(page)))

        box = self._find_chat_input(page)
        if box is None:
            return self._restart_chat(brand, part, "giris kutusu bulunamadi")
        try:
            ph = box.get_attribute("placeholder") or box.get_attribute("aria-label") or "?"
        except Exception:
            ph = "?"
        print(f"    [chat] ayni konusmada takip sorusu ('{ph}' kutusu)")
        try:
            box.click()
            try:
                box.fill(fq)               # textarea: newline'siz tek satir
            except Exception:
                page.keyboard.type(fq)
            page.keyboard.press("Enter")
        except Exception as e:
            return self._restart_chat(brand, part, f"kutuya yazilamadi ({e})")

        time.sleep(1.5)   # gonderim sonrasi ilk navigasyon/churn gecsin

        # Enter islendi mi? Kutuda hala bizim metin duruyorsa soru GONDERILMEDI
        # (uzun konusmada kutu pasiflesebiliyor). Beklemeden sifirla.
        try:
            if (box.input_value() or "").strip() == fq.strip():
                return self._restart_chat(brand, part, "takip sorusu gonderilemedi")
        except Exception:
            pass   # contenteditable / DOM degismis: normal bekleme yolu karar versin

        # Yeni cevabi bekle: "oem no:" satir sayisi ARTMALI (echo satir-basi degil).
        start = time.time()
        text = ""
        while time.time() - start < limit:
            if self._looks_like_captcha(page):
                return self._restart_chat(brand, part, "CAPTCHA")
            text = self._extract_answer(page)
            if len(_OEM_LABEL_RE.findall(text)) > prev or self._is_ai_error(text):
                break
            time.sleep(1.0)
        time.sleep(1.5)
        text = self._extract_answer(page)

        # Yeni cevap gelmedi (ya da Google hata verdi): STALE metni ASLA parse etme.
        # Konusma bu noktadan sonra genelde toparlamiyor -> sifirla ve ayni urunu
        # taze aramayla sor. Boylece urun kaybolmaz, zincirleme bos cevap olmaz.
        if len(_OEM_LABEL_RE.findall(text)) <= prev:
            reason = ("Google yanit uretemedi" if self._is_ai_error(text)
                      else f"{limit}s icinde yeni cevap gelmedi")
            return self._restart_chat(brand, part, reason)

        sources = self._extract_sources(page)
        self._chat_turns += 1
        self._sleep()
        return text, sources

    def _build_batch_query(self, items) -> str:
        parts_block = "\n".join(f"{b} {p}" for b, p in items)
        tmpl = self.cfg.get("batch_query_template") or _DEFAULT_BATCH_TMPL
        return tmpl.format(parts=parts_block, n=len(items))

    def ask_batch(self, items):
        """items: [(brand, part), ...] -> tek sorguda hepsini sorar.

        Donen: (tam_cevap_metni, kaynaklar). Metni parser.parse_batch ayristirir.
        Istek sayisini ~batch_size kat azaltir -> cok daha az CAPTCHA/hata.
        """
        page = self._page
        timeout_ms = self.cfg.get("timeout_sec", 45) * 1000
        unattended = self.cfg.get("unattended", False)
        cooldown = int(self.cfg.get("captcha_cooldown_sec", 600))
        max_attempts = int(self.cfg.get("captcha_max_attempts", 3))
        ai_error_retries = int(self.cfg.get("ai_error_retries", 2))
        batch_timeout = int(self.cfg.get("batch_timeout_sec", 90))
        expected = len(items)

        url = ("https://www.google.com/search?udm=50&q="
               + urllib.parse.quote_plus(self._build_batch_query(items)))

        text = ""
        for ai_attempt in range(ai_error_retries + 1):
            # goto + CAPTCHA
            attempt = 0
            while True:
                page.goto(url, timeout=timeout_ms)
                if not self._looks_like_captcha(page):
                    break
                if not unattended:
                    input("\n[!] CAPTCHA / dogrulama gorunuyor. Tarayicida coz, "
                          "sonra ENTER'a bas...")
                    break
                attempt += 1
                if attempt > max_attempts:
                    raise CaptchaBlocked(
                        f"{max_attempts} denemede CAPTCHA asilamadi (unattended)")
                w = min(cooldown * attempt, 3600)
                print(f"    [captcha] unattended: {w} sn bekleyip tekrar denenecek "
                      f"({attempt}/{max_attempts})")
                time.sleep(w)

            # cevabi bekle: TABLO veri satiri sayisi >= parca sayisi (ya da hata/timeout)
            start = time.time()
            while time.time() - start < batch_timeout:
                text = self._extract_answer(page)
                if _table_row_count(text) >= expected or self._is_ai_error(text):
                    break
                time.sleep(1.5)
            time.sleep(2)
            text = self._extract_answer(page)

            if _table_row_count(text) >= 1 and not self._is_ai_error(text):
                break
            if self._is_ai_error(text) and ai_attempt < ai_error_retries:
                w = 8 + ai_attempt * 8
                print(f"    [ai-hata] Google yanit uretemedi, {w}s sonra tekrar "
                      f"({ai_attempt + 1}/{ai_error_retries})")
                time.sleep(w)

        sources = self._extract_sources(page)
        self._sleep()
        return text, sources

    def _extract_sources(self, page) -> list:
        """AI Modu cevabindaki atif/kaynak baglantilarini toplar.

        Disari acilan http(s) linklerini alir; google/gstatic ic linkleri eler.
        """
        urls = []
        try:
            for a in page.query_selector_all("a[href^='http']"):
                href = a.get_attribute("href") or ""
                if not href.startswith("http"):
                    continue
                if any(d in href for d in (
                    "google.com", "gstatic.com", "googleusercontent.com",
                    "youtube.com/redirect", "accounts.google",
                )):
                    continue
                if href not in urls:
                    urls.append(href)
        except Exception:
            pass
        return urls

    def _looks_like_captcha(self, page) -> bool:
        # Sayfa navigasyon halindeyken page.content() patlayabilir; guvenli oku.
        try:
            html = (page.content() or "").lower()
        except Exception:
            try:
                page.wait_for_load_state("domcontentloaded", timeout=5000)
                html = (page.content() or "").lower()
            except Exception:
                return False   # okunamadi -> captcha varsaymayiz
        return any(s in html for s in (
            "recaptcha", "unusual traffic", "olagan disi trafik",
            "not a robot", "robot degil",
        ))

    def _is_ai_error(self, text: str) -> bool:
        """Google AI Modu 'yanit uretilemedi' hatasi verdi mi?"""
        t = (text or "").lower()
        return any(s in t for s in (
            "yapay zeka yanıtı üretilemedi",
            "yanıt üretilemedi",
            "bir hata oluş",
            "couldn't generate",
            "can't generate",
            "something went wrong",
            "an error occurred",
        ))

    def _extract_answer(self, page) -> str:
        """Cevabi iceren metni dondurur.

        ONEMLI (canli teshis): AI Modu'nda div[role='main'] cogu zaman CSS/stil
        blogu donuyor (etiket icermez) -> onceki surum bunu ilk alip CSS
        yakaliyordu. Gercek cevap body.innerText'te (ve .Se0jFd konteynerinde).
        Bu yuzden ETIKET ('oem no'/'parça ad') iceren ilk adayi seceriz; boyle
        biri yoksa en dolu metni dondururuz (parser prompt yankisini eler).
        """
        cands = []
        for sel in ("body", "div[role='main']", "#rcnt"):
            try:
                el = page.query_selector(sel)
                if el:
                    t = el.inner_text()
                    if t and t.strip():
                        cands.append(t)
            except Exception:
                continue
        # 1) TABLO iceren aday (tab + rakam satiri) -> batch cevabi burada.
        #    (div.Se0jFd gibi konteynerler PROMPT echosunu yakalayip tabloyu
        #     ISKALIYORDU; o yuzden once gercek tabloyu ariyoruz.)
        for t in cands:
            if any(("\t" in ln and re.search(r"\d", ln)) for ln in t.splitlines()):
                return t
        # 2) Etiket iceren aday -> tek-parca (parça adı:/oem no:) cevabi.
        for t in cands:
            if re.search(r"oem\s*no|par[çc]a\s*ad", t, re.IGNORECASE):
                return t
        return max(cands, key=len) if cands else ""
