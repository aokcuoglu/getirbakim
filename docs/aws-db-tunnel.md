# Production veritabanına yerel erişim


Production veritabanına kendi bilgisayarınızdan `psql` veya bir veritabanı arayüzüyle bağlanabilirsiniz. Bağlantı AWS Session Manager üzerinden kuruluyor:

- Veritabanı internete açılmıyor, bastion sunucusu kurulmuyor, yeni bir port açılmıyor.
- Script: `scripts/aws/db-tunnel.sh`. Infra reposuna gerek yok.
- Bağlantı uygulamanın veritabanı kullanıcısıyla kuruluyor (`DATABASE_URL`'deki kullanıcı).

Nasıl çalışıyor: Script, private subnet'te kısa ömürlü bir `db-admin` görevi başlatıyor ve veritabanının 5432 portunu bu görev üzerinden bilgisayarınızda `localhost:15432`'ye bağlıyor. Ctrl-C ile çıktığınızda görev duruyor. Terminal beklenmedik şekilde kapanırsa görev en geç 4 saat sonra kendiliğinden kapanıyor.

## Gereksinimler

| Gereksinim | Kurulum / kontrol |
|---|---|
| AWS CLI v2 | `aws --version` |
| Session Manager plugin | `brew install --cask session-manager-plugin`, kontrol: `session-manager-plugin --version` |
| Node.js | Uygulama için zaten kurulu. Script yalnız bağlantı adresini oluşturmak için kullanıyor. |
| `psql` veya bir veritabanı arayüzü | `brew install libpq` ya da TablePlus, DBeaver, Postico gibi bir arayüz |
| AWS CLI profili | Production hesabına (`221484883374`) erişen profil. |

Mac'ten CDK deploy ettiğiniz profil yeterli, ek bir IAM yetkisi gerekmiyor.

### Profil hazır değilse

Profil iki katmandan oluşuyor: management hesabındaki `getirbakim-ops` kullanıcısı (kimlik) ve production hesabındaki `OrganizationAccountAccessRole` rolü (yetki). `~/.aws/config` dosyasına şunu ekleyin. Profil adları örnek, istediğiniz adı verebilirsiniz:

```ini
[profile getirbakim-ops]
region = eu-central-1

[profile getirbakim-production]
role_arn = arn:aws:iam::221484883374:role/OrganizationAccountAccessRole
source_profile = getirbakim-ops
role_session_name = getirbakim-ops
region = eu-central-1
```

Giriş yapın ve kontrol edin:

```bash
aws login --profile getirbakim-ops
aws sts get-caller-identity --profile getirbakim-production
```

- `aws login` tarayıcıyı açıyor. Konsol girişindeki gibi kullanıcı adı, şifre ve güvenlik anahtarıyla giriş yapılıyor; access key gerekmiyor. Komut AWS CLI 2.32 ve sonrasında var (`aws --version`).
- İkinci komutun çıktısında `Account` değeri `221484883374` olmalı.
- Script'e rol profilinin adı veriliyor: `bash scripts/aws/db-tunnel.sh getirbakim-production`. CLI, production rolüne geçişi her komutta kendisi yapıyor.
- `aws login` oturumu birkaç saat geçerli. Süre dolunca `aws login` komutunu yeniden çalıştırın.
- `role_session_name` zorunlu değil. Verildiğinde CloudTrail kayıtlarında işlemler bu adla görünüyor.

## Kullanım

App reposunun kök dizininde tüneli açın (`<profil>` yerine kendi profil adınızı yazın):

```bash
bash scripts/aws/db-tunnel.sh <profil>
```

Script önce profilin production hesabında olduğunu kontrol ediyor, ardından görevi başlatıyor. Görevin hazır olması yaklaşık 1 dakika sürüyor. Hazır olunca bağlantı adresini yazıyor ve `Waiting for connections...` satırıyla bekliyor:

```text
  psql "postgresql://<kullanıcı>:<şifre>@localhost:15432/getirbakim?sslmode=require"
  Ctrl-C closes the tunnel and stops the task
```

Bu terminal açık kaldığı sürece tünel açık kalır. Başka bir terminalde yazdırılan komutla bağlanın:

```bash
psql "postgresql://<kullanıcı>:<şifre>@localhost:15432/getirbakim?sslmode=require"
```

Bir arayüz kullanıyorsanız aynı bilgileri girin:

| Alan | Değer |
|---|---|
| Host | `localhost` |
| Port | `15432` |
| Database | `getirbakim` |
| Kullanıcı ve şifre | Script'in yazdırdığı adresteki değerler |
| SSL | `require` |

İşiniz bitince tünelin açık olduğu terminalde Ctrl-C'ye basın. Script görevi durdurur.

### Seçenekler

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `--port <port>` | `15432` | Bilgisayarınızdaki port. Yereldeki PostgreSQL 5432'yi kullandığı için varsayılan farklı. |
| `--hours <saat>` | `4` | Görevin en fazla açık kalacağı süre (1–12 saat). |

## Bilinmesi gerekenler

- **Yetki:** Bağlantı uygulamanın kullanıcısıyla kuruluyor. Uygulamanın yapabildiği her şey bu bağlantıyla da yapılabiliyor, veri değiştirme ve silme dahil. Yazma işlemlerinden önce bir transaction açmanızı (`BEGIN`) ve sonucu kontrol ettikten sonra `COMMIT` etmenizi öneriyoruz.
- **SSL:** `sslmode=require` ile bağlantı şifreli. `verify-full` çalışmıyor, çünkü sertifikada `localhost` değil veritabanının AWS adresi yazıyor. Trafik zaten Session Manager tünelinin içinden geçiyor.
- **Bağlantı kopması:** Session Manager boşta kalan oturumları bir süre sonra kapatıyor. Tünel kapanırsa script'i yeniden çalıştırın.
- **Şifre:** Script'in yazdırdığı adreste uygulamanın veritabanı şifresi var. Bu adresi paylaşmayın, bir dosyaya ya da ekran görüntüsüne kaydetmeyin.
- **Maliyet:** Görev açık kaldığı sürece küçük bir Fargate ücreti oluşuyor. Ctrl-C ile kapatıldığında ücret de duruyor.
- **Kayıt:** Görevin başlatılması ve durdurulması CloudTrail'de, ECS kümesinde `db-tunnel` olarak görünüyor.

## Sorun giderme

| Mesaj | Çözüm |
|---|---|
| `Session Manager plugin not installed` | `brew install --cask session-manager-plugin` |
| `profile '...' is not logged in` | Profilin kimlik bilgilerini yenileyin, `aws sts get-caller-identity --profile <profil>` ile kontrol edin. |
| `profile '...' is in account ..., expected 221484883374` | Profil production hesabına değil başka bir hesaba bakıyor. Production'a geçen profili kullanın. |
| `address already in use` | Port kullanımda. `--port 15433` gibi başka bir port verin. |
| `the task was not ready within 5 minutes` | Script'i yeniden çalıştırın. Tekrar ederse görevin log'una bakın: `/getirbakim-production/db-admin`. |
