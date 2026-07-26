#!/bin/bash
# Sanal ekranı kurar, sonra verilen komutu çalıştırır.
#
# `xvfb-run` yerine elle: xvfb-run bu imajda ekranı açıp komutu hiç
# çalıştırmadan asılı kalıyor (kapta yalnız Xvfb + xvfb-run kalır, çıktı
# gelmez). Elle başlatmak aynı işi yapıyor ve davranışı görünür.
set -e

DISPLAY_NUM="${DISPLAY_NUM:-99}"
SCREEN="${XVFB_SCREEN:-1440x900x24}"
PROFILE_DIR="${REPXPERT_PROFILE_DIR:-/app/.data/repxpert/profile}"

# Bayat profil kilidini temizle.
#
# Chromium profili kilitler ve kilidi kapanırken bırakır; sert kapanmada
# (docker kill, OOM, kabın altından çekilen ağ) dosya kalır ve sonraki açılış
# "The profile appears to be in use by another Chromium process" ile ölür.
# `restart: on-failure` üç kez deneyip pes ettiği için süpürme sessizce durur —
# gözetimsiz koşuda bu, ertesi gün durmuş bulmak demek.
#
# Kabın AÇILIŞINDA hiçbir tarayıcı meşru olarak kilidi tutamaz (compose tek kap
# çalıştırır ve bu betik tarayıcıdan önce koşar), dolayısıyla silmek güvenli.
if [ -e "${PROFILE_DIR}/SingletonLock" ]; then
  echo "[entrypoint] bayat profil kilidi temizleniyor: $(readlink "${PROFILE_DIR}/SingletonLock" 2>/dev/null || echo '?')"
  rm -f "${PROFILE_DIR}/SingletonLock" "${PROFILE_DIR}/SingletonSocket" "${PROFILE_DIR}/SingletonCookie"
fi

# Bayat X kilidini temizle.
#
# Kap yeniden BAŞLATILDIĞINDA (yeniden yaratılmadığında) /tmp korunur ve önceki
# koşunun bıraktığı kilit Xvfb'yi "Server is already active for display 99" ile
# öldürür. Yani tam da yeniden başlatmanın kurtarması gereken durumda —
# veritabanı kesintisi, çökme — kurtarma yolu kapanıyordu.
#
# Kap açılışında bu görüntüde çalışan bir X sunucusu olamaz, silmek güvenli.
if [ -e "/tmp/.X${DISPLAY_NUM}-lock" ]; then
  echo "[entrypoint] bayat X kilidi temizleniyor: /tmp/.X${DISPLAY_NUM}-lock"
  rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"
fi

Xvfb ":${DISPLAY_NUM}" -screen 0 "${SCREEN}" >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

# Ekran hazır olmadan tarayıcı açılırsa "Missing X server" ile çöker.
for _ in $(seq 1 30); do
  if xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then
  echo "[entrypoint] Xvfb :${DISPLAY_NUM} açılamadı" >&2
  cat /tmp/xvfb.log >&2 || true
  exit 1
fi

export DISPLAY=":${DISPLAY_NUM}"
echo "[entrypoint] Xvfb :${DISPLAY_NUM} hazır (pid ${XVFB_PID}) · komut: $*"

# exec: sinyaller (docker stop) doğrudan scraper'a gitsin, kabuk araya girmesin.
exec "$@"
