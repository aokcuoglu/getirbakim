# CI için Mac runner (#1047)

Depo GitHub Free planında private olunca aylık 2.000 Actions dakikası CI'ya yetmez (Kasım 2026'da ayda ~3.400 dk). Bu yüzden `ci.yml` işi sahibinin Mac'inde, depoya kayıtlı bir self-hosted runner üzerinde de koşabilir. Hangi runner'ın kullanılacağını `CI_RUNS_ON` depo değişkeni belirler:

- **Tanımsız (varsayılan):** GitHub-hosted `ubuntu-24.04`. Depo public iken böyle kalır.
- **`["self-hosted","macOS","ARM64","getirbakim"]`:** Mac runner. Yalnız depo private olduktan sonra.

Değer JSON'dur (`runs-on: ${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-24.04"') }}`); tek bir etiket de tırnaklı yazılır (`"ubuntu-24.04"`).

> **Depo public iken runner kaydetme ve `CI_RUNS_ON` tanımlama.** Public depoda fork'tan gelen bir PR, workflow dosyasını değiştirerek kendi kodunu bu Mac'te çalıştırabilir. Kurulum betiği public depoda çalışmayı reddeder; `ci.yml` de public depoda self-hosted runner'a düşen işi checkout'tan önce durdurur, ama asıl koruma runner'ın hiç kayıtlı olmamasıdır.

`release-aws.yml` bu ayardan etkilenmez: AWS yayın işi her zaman GitHub-hosted `ubuntu-24.04-arm` üzerinde koşar (ayda ~150 dk, Free kotası içinde) ve AWS kimlik bilgileri Mac'e hiç gelmez. Yayından önce koşan CI (`check`) ise `CI_RUNS_ON`'u izler.

## Gereksinimler

- Apple Silicon Mac, Docker Desktop açık (CI, Postgres 16'yı `docker run` ile başlatır).
- `gh` sahibin hesabıyla oturum açmış (`gh auth status`); runner kayıt token'ı depo yöneticisi ister.
- `docker` ve `git` betiğin çalıştırıldığı kabuğun `PATH`'inde (servis bu `PATH`'i saklar).

CI'nın Postgres'i yerel veritabanına (5432), tünellere (54323, 15432) ve `localhost:3000` dev sunucusuna dokunmaz: konteyner `getirbakim-ci-pg-<run_id>-<attempt>` adıyla, Docker'ın seçtiği boş bir `127.0.0.1` portunda açılır ve iş bitince (hata ya da iptal dahil) silinir. İş yarıda öldürülürse kalan konteynerler `docker ps -a --filter label=getirbakim-ci` ile bulunup `docker rm -f` ile silinir.

## Kurulum

Depo private yapıldıktan sonra, ana checkout'ta:

```bash
scripts/ci/mac-runner-setup.sh
```

Betik şunları yapar:

1. `~/actions-runner-getirbakim` dizinine sabit sürümlü `actions/runner` (osx-arm64) arşivini indirir ve SHA-256'sını doğrular.
2. Kısa ömürlü kayıt token'ını alır: `gh api -X POST repos/aokcuoglu/getirbakim/actions/runners/registration-token`.
3. Runner'ı `self-hosted,macOS,ARM64,getirbakim` etiketleriyle, kendi `_work` dizininde kaydeder.
4. launchd servisi olarak kurar ve başlatır (`./svc.sh install && ./svc.sh start`). Bu bir kullanıcı ajanıdır (LaunchAgent): Mac açılınca değil, runner kullanıcısı oturum açınca başlar.

`RUNNER_DIR` ve `RUNNER_NAME` ortam değişkenleriyle dizin ve ad değiştirilebilir. Runner sürümünü yükseltmek için betikteki `RUNNER_VERSION` / `RUNNER_SHA256` değerleri [actions/runner sürüm notlarından](https://github.com/actions/runner/releases) güncellenir; runner kendini de otomatik günceller.

### Ayrı macOS kullanıcısı (önerilen sertleştirme)

Runner, betiği çalıştıran macOS kullanıcısı olarak koşar. PR kodu (`npm ci` sırasındaki `postinstall` betikleri, testler) o kullanıcının her şeyine erişebilir: `~/.aws`, `gh` token'ı, SSH anahtarları, `.env.local` dosyaları, yerel veritabanı ve tünelleri. Private depoda bu kod yalnız yazma yetkisi olanlardan gelir, yine de runner'ı ayrı bir standart macOS kullanıcısında koşturmak önerilir:

1. Sistem Ayarları → Kullanıcılar ve Gruplar'dan yönetici olmayan bir kullanıcı (ör. `ghrunner`) aç; Docker Desktop'ı o kullanıcının oturumunda da başlat.
2. O kullanıcıyla oturum açıp `gh auth login` (sahibin hesabı, yalnız kayıt için; ardından `gh auth logout` olabilir) ve depoyu klonla.
3. Betiği o kullanıcı olarak çalıştır; `RUNNER_DIR` o kullanıcının evinde kalır (varsayılan `~/actions-runner-getirbakim` zaten öyledir).
4. Servis kullanıcı ajanı olduğu için runner, `ghrunner` oturumu açıkken (hızlı kullanıcı değiştirme ile arka planda) çalışır.

## CI'yı Mac'e almak ve geri dönmek

```bash
# Mac runner'a al (depo private, runner GitHub'da "Idle")
gh variable set CI_RUNS_ON -R aokcuoglu/getirbakim --body '["self-hosted","macOS","ARM64","getirbakim"]'

# GitHub-hosted'a dön (depo yeniden public olacaksa önce bu, sonra runner'ı kaldır)
gh variable delete CI_RUNS_ON -R aokcuoglu/getirbakim
scripts/ci/mac-runner-setup.sh remove
```

Mac kapalıyken veya Docker Desktop durmuşken CI işleri kuyrukta bekler ya da Postgres adımında düşer; acil durumda değişkeni silmek işi yeniden GitHub-hosted'a taşır (dakika kotası el veriyorsa).

## AWS yayını (`release-aws.yml`)

Free + private depoda GitHub ortamları (`production`) yoktur. Yayın değişkenleri ve `INFRA_DEPLOY_KEY` depo düzeyindedir; komutlar workflow dosyasının başındadır. Onayın yerini koruma işi alır; şu durumlarda CI'dan ve her AWS çağrısından önce durur (dal ve tetikleyen kontrolü, yalnız başarısız işi yeniden koşturmaya karşı `release` işinin ilk adımında da tekrarlanır):

- dal `main` değilse,
- tetikleyen (veya yeniden koşturan) depo sahibi değilse,
- zorunlu `version` girdisi `package.json` sürümüne eşit değilse.

```bash
gh workflow run release-aws.yml --ref main -f version=0.31.0
```

Korumalar yanlışlıkla tetiklemeyi önler, yazma yetkili bir iş birlikçiyi değil. Depoda yazma yetkisi olan bir iş birlikçi var ve Free + private depoda dal koruması yoktur: bu kişi `main`'deki `release-aws.yml`'i değiştirebilir. Depo düzeyindeki `INFRA_DEPLOY_KEY` secret'ı da onun herhangi bir dala push ettiği her workflow'dan okunabilir.

### Geçiş sırası

1. getirbakim-infra PR #6'yı (Cicd yığını; yayın rolü ortam yerine `main`'e güvenir) deploy et.
2. OIDC subject'ini özelleştir. Bu yapılmazsa subject `repo:aokcuoglu/getirbakim:ref:refs/heads/main` olur ve AssumeRole başarısız olur:
   ```bash
   gh api -X PUT repos/aokcuoglu/getirbakim/actions/oidc/customization/sub -F use_default=false \
     -f 'include_claim_keys[]=repo' -f 'include_claim_keys[]=context' -f 'include_claim_keys[]=job_workflow_ref'
   ```
3. Depo düzeyi değişkenleri ve `INFRA_DEPLOY_KEY` secret'ını tanımla (`release-aws.yml` başındaki komutlar). Bugün `production` ortamında olmayan `PRODUCTION_GELIVER_SYNC_ENABLED=false` da eklenir.
4. Bu değişikliği bir sürümle `main`'e al.
5. Depoyu private yap, Mac runner'ı kaydet, `CI_RUNS_ON`'u tanımla.
