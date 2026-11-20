# Production veritabanına yerel erişim


Production veritabanına kendi bilgisayarınızdan `psql` veya bir veritabanı arayüzüyle bağlanabilirsiniz. Bağlantı AWS Session Manager üzerinden kuruluyor:

- Veritabanı internete açılmıyor, bastion sunucusu kurulmuyor, yeni bir port açılmıyor.
- Script: `scripts/aws/db-tunnel.sh`. Infra reposuna gerek yok.
- Bağlantı varsayılan olarak salt-okunur `getirbakim_readonly` rolüyle kuruluyor. Bu rol okuyabiliyor, veri değiştiremiyor. Uygulamanın kullanıcısıyla (`DATABASE_URL`'deki kullanıcı, yazma yetkili) bağlanmak için `--write` seçeneği açıkça verilmeli.

Nasıl çalışıyor: Script, private subnet'te kısa ömürlü bir `db-admin` görevi başlatıyor ve veritabanının 5432 portunu bu görev üzerinden bilgisayarınızda `localhost:15432`'ye bağlıyor. Ctrl-C ile çıktığınızda görev duruyor. Terminal beklenmedik şekilde kapanırsa görev en geç 4 saat sonra kendiliğinden kapanıyor.

## Gereksinimler

| Gereksinim | Kurulum / kontrol |
|---|---|
| AWS CLI v2 | `aws --version` |
| Session Manager plugin | `brew install --cask session-manager-plugin`, kontrol: `session-manager-plugin --version` |
| macOS Anahtar Zinciri kaydı | Salt-okunur rolün şifresi (bkz. [Salt-okunur şifreyi Anahtar Zinciri'ne ekleme](#salt-okunur-şifreyi-anahtar-zincirine-ekleme)). |
| Node.js | Uygulama için zaten kurulu. Script yalnız `--write` ile uygulama kullanıcısının bilgilerini okumak için kullanıyor. |
| `psql` veya bir veritabanı arayüzü | `brew install libpq` ya da TablePlus, DBeaver, Postico gibi bir arayüz. `--psql` seçeneği için `psql` gerekli. |
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

### Salt-okunur şifreyi Anahtar Zinciri'ne ekleme

Script `getirbakim_readonly` şifresini macOS Anahtar Zinciri'nden okuyor; şifre repoda, dosyada veya kabuk geçmişinde tutulmuyor. Şifreyi yöneticiden alın ve bir kez ekleyin:

```bash
security add-generic-password -a getirbakim_readonly -s getirbakim-prod-readonly -w
```

Komut şifreyi iki kez soruyor. Şifre değiştiğinde aynı komutu `-U` ile çalıştırın (`security add-generic-password -U -a getirbakim_readonly -s getirbakim-prod-readonly -w`). Kontrol: `security find-generic-password -s getirbakim-prod-readonly` (şifreyi yazdırmadan kaydı gösterir).

Kayıt yoksa script AWS'ye hiç bağlanmadan bu komutu hatırlatarak duruyor.

## Kullanım

App reposunun kök dizininde tüneli açın (`<profil>` yerine kendi profil adınızı yazın):

```bash
bash scripts/aws/db-tunnel.sh <profil>
```

Script önce profilin production hesabında olduğunu kontrol ediyor, ardından görevi başlatıyor. Görevin hazır olması yaklaşık 1 dakika sürüyor. Hazır olunca bağlantı adresini şifresiz yazıyor ve `Waiting for connections...` satırıyla bekliyor:

```text
  psql "postgresql://getirbakim_readonly@localhost:15432/getirbakim?sslmode=require"
  Password: security find-generic-password -s getirbakim-prod-readonly -w | pbcopy
  Ctrl-C closes the tunnel and stops the task
```

Bu terminal açık kaldığı sürece tünel açık kalır. Başka bir terminalde yazdırılan komutla bağlanın; `psql` şifreyi soruyor. Şifreyi panoya almak için ikinci satırdaki komutu kullanın, ekrana yazdırmayın.

Bir arayüz kullanıyorsanız aynı bilgileri girin:

| Alan | Değer |
|---|---|
| Host | `localhost` |
| Port | `15432` |
| Database | `getirbakim` |
| Kullanıcı | `getirbakim_readonly` |
| Şifre | Anahtar Zinciri'ndeki değer (yukarıdaki `pbcopy` komutu) |
| SSL | `require` |

### Doğrudan psql (`--psql`)

Tüneli açıp `psql`'i aynı terminalde başlatmak için:

```bash
bash scripts/aws/db-tunnel.sh <profil> --psql
```

Şifre ekrana yazılmıyor, `psql`'e `PGPASSWORD` ortam değişkeniyle veriliyor. `psql`'den çıkınca (`\q`) tünel kapanıyor ve görev duruyor. `--` sonrasındaki argümanlar `psql`'e geçiyor, örneğin tek bir sorgu ya da dosya:

```bash
bash scripts/aws/db-tunnel.sh <profil> --psql -- -c "SELECT count(*) FROM commerce_orders"
bash scripts/aws/db-tunnel.sh <profil> --psql -- -f rapor.sql
```

### Yazma yetkili bağlantı (`--write`)

Veri değiştirmeniz gerekiyorsa uygulama kullanıcısıyla bağlanın:

```bash
bash scripts/aws/db-tunnel.sh <profil> --write          # şifreli adresi yazdırır
bash scripts/aws/db-tunnel.sh <profil> --write --psql   # şifreyi yazdırmadan psql açar
```

Script başta production'a yazılabileceği uyarısını veriyor. Şifre ekranda görünmesin diye `--write --psql` tercih edin. Yazma işlemlerinden önce bir transaction açın (`BEGIN`), sonucu kontrol ettikten sonra `COMMIT` edin.

İşiniz bitince tünelin açık olduğu terminalde Ctrl-C'ye basın. Script görevi durdurur.

### Seçenekler

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `--readonly` | açık | `getirbakim_readonly` rolüyle bağlanır. Şifre Anahtar Zinciri'nden okunur, ekrana yazılmaz. |
| `--write` | kapalı | Uygulama kullanıcısıyla (yazma yetkili) bağlanır. |
| `--psql [-- <psql argümanları>]` | kapalı | Tüneli açıp `psql`'i başlatır; şifre `PGPASSWORD` ile verilir. `psql`'den çıkınca tünel kapanır. |
| `--port <port>` | `15432` | Bilgisayarınızdaki port. Yereldeki PostgreSQL 5432'yi kullandığı için varsayılan farklı. |
| `--hours <saat>` | `4` | Görevin en fazla açık kalacağı süre (1–12 saat). |

## Bilinmesi gerekenler

- **Yetki:** Varsayılan bağlantı salt-okunur. `getirbakim_readonly` rolünün tablolarda yalnız `SELECT` yetkisi var; `INSERT/UPDATE/DELETE` `permission denied` ile, oturum ayarı yüzünden önce `cannot execute ... in a read-only transaction` ile reddediliyor. `--write` ile açılan bağlantıda ise uygulamanın yapabildiği her şey yapılabiliyor, veri değiştirme ve silme dahil.
- **SSL:** `sslmode=require` ile bağlantı şifreli. `verify-full` çalışmıyor, çünkü sertifikada `localhost` değil veritabanının AWS adresi yazıyor. Trafik zaten Session Manager tünelinin içinden geçiyor.
- **Oturum sınırları:** Salt-okunur rolde bir sorgu en fazla 5 dakika sürebiliyor (`statement_timeout`), transaction içinde 10 dakika boşta kalan oturum kapatılıyor (`idle_in_transaction_session_timeout`) ve aynı anda en fazla 5 bağlantı açılabiliyor. Uzun bir rapor sorgusu için oturumda `SET statement_timeout = '30min';` verebilirsiniz.
- **Advisory lock:** `pg_advisory_lock` gibi fonksiyonlar herkese açık ve salt-okunur rol için ayrıca kapatılamıyor. Bu bağlantıdan advisory lock almayın: `scripts/setup.ts` yayın sırasında `pg_advisory_xact_lock(20261001, n)` anahtarlarıyla sıraya giriyor, tutulan bir kilit yayını bekletir.
- **Bağlantı kopması:** Session Manager boşta kalan oturumları bir süre sonra kapatıyor. Tünel kapanırsa script'i yeniden çalıştırın.
- **Şifre:** Salt-okunur modda ve `--psql` ile şifre ekrana yazılmıyor. `--write` (`--psql` olmadan) yazdırdığı adreste uygulamanın veritabanı şifresi var. Bu adresi paylaşmayın, bir dosyaya ya da ekran görüntüsüne kaydetmeyin.
- **Maliyet:** Görev açık kaldığı sürece küçük bir Fargate ücreti oluşuyor. Ctrl-C ile kapatıldığında ücret de duruyor.
- **Kayıt:** Görevin başlatılması ve durdurulması CloudTrail'de, ECS kümesinde `db-tunnel` olarak görünüyor.

## Sorun giderme

| Mesaj | Çözüm |
|---|---|
| `Session Manager plugin not installed` | `brew install --cask session-manager-plugin` |
| `no Keychain item 'getirbakim-prod-readonly'` | Salt-okunur şifreyi Anahtar Zinciri'ne ekleyin (yukarıdaki `security add-generic-password` komutu). |
| `permission denied for table ...` / `read-only transaction` | Salt-okunur bağlantıda beklenen davranış. Yazmanız gerekiyorsa `--write` ile bağlanın. |
| `password authentication failed for user "getirbakim_readonly"` | Anahtar Zinciri'ndeki şifre eski. `-U` ile güncelleyin. |
| `profile '...' is not logged in` | Profilin kimlik bilgilerini yenileyin, `aws sts get-caller-identity --profile <profil>` ile kontrol edin. |
| `profile '...' is in account ..., expected 221484883374` | Profil production hesabına değil başka bir hesaba bakıyor. Production'a geçen profili kullanın. |
| `address already in use` | Port kullanımda. `--port 15433` gibi başka bir port verin. |
| `the task was not ready within 5 minutes` | Script'i yeniden çalıştırın. Tekrar ederse görevin log'una bakın: `/getirbakim-production/db-admin`. |

## Salt-okunur rolün kurulumu (yönetici, bir kez)

`getirbakim_readonly` rolü production'da elle, yazma yetkili tünelden oluşturuluyor. Rol infra (CDK) tarafında değil; SQL dosyası `scripts/aws/readonly-role.sql`. Dosya bilerek `db/` altında değil, yayın sırasındaki `db:setup` onu çalıştırmıyor. Dosya tekrar çalıştırılabilir: yetkileri yeniden veriyor ve şifreyi güncelliyor (şifre değiştirme de aynı yol).

Dosyanın yaptıkları:

- `getirbakim_readonly` rolünü yoksa `LOGIN` olarak oluşturur ve şifresini ayarlar.
- Veritabanına `CONNECT`, `public` şemasına `USAGE`, tüm tablo, view ve sequence'lere `SELECT` verir.
- `ALTER DEFAULT PRIVILEGES FOR ROLE getirbakim_app` ile uygulamanın ileride oluşturacağı tabloları da okunur yapar.
- İkinci koruma olarak rol için `default_transaction_read_only = on` ayarlar.
- Oturum sınırlarını koyar: `statement_timeout = 5min`, `idle_in_transaction_session_timeout = 10min`, `CONNECTION LIMIT 5`.
- Sonunda doğrulama tablolarını yazdırır.

**Kim çalıştırmalı:** RDS'te superuser yok. Rol oluşturmak için çalıştıran kullanıcının `CREATEROLE` yetkisi gerekiyor. Önce kontrol edin (`--write --psql` ile bağlanıp):

```sql
SELECT rolname, rolcreaterole, rolsuper FROM pg_roles WHERE rolname IN (current_user, 'getirbakim_app');
```

- `getirbakim_app` için `rolcreaterole = t` ise dosyayı uygulama kullanıcısıyla (`--write`) çalıştırın.
- `f` ise RDS master kullanıcısıyla (`rds_superuser`, `CREATEROLE` yetkili) çalıştırın. Master'ın şifresi Secrets Manager'daki master secret'ında. Tablo yetkileri tabloların sahibi adına verildiği için master'ın `getirbakim_app` üyesi olması gerekiyor; değilse dosya durup şu komutu öneriyor: `GRANT getirbakim_app TO <master>;`.
- PostgreSQL 16 ve sonrasında rolü yalnız onu oluşturan kullanıcı (veya üstündeki rol) değiştirebiliyor. Sonraki çalıştırmalarda aynı kullanıcıyı kullanın.

**Şifre sunucuya gitmiyor:** Dosya şifreyi `psql` içinden Anahtar Zinciri'nden okuyor (`security find-generic-password -s getirbakim-prod-readonly -w`) ve bilgisayarınızda `scripts/aws/scram-verifier.mjs` ile SCRAM-SHA-256 doğrulayıcısına çeviriyor. Sunucuya yalnız bu doğrulayıcı (`PASSWORD 'SCRAM-SHA-256$…'`) gidiyor; `log_statement`, `log_min_duration_statement`, hata log'ları veya `pg_stat_statements` açık olsa bile şifrenin kendisi hiçbir yere yazılmıyor. Şifre ya da doğrulayıcı komut satırına argüman olarak verilmiyor. Dosya, log ayarlarını bilgi olarak yazdırıyor. Bu yüzden dosyayı repo kökünden çalıştırın; `security` ve Node.js gerekli. Şifre en az 16 karakter olmalı, yalnız boşluksuz ASCII karakterler içermeli (aşağıdaki üretim komutu buna uyuyor).

Anahtar Zinciri kaydı yoksa veya şifre uygun değilse, `CREATEROLE` yetkisi ya da üyelik eksikse dosya değişiklik yapmadan açıklamayla duruyor. Uzantıların (`pg_stat_statements` gibi) `public` şemasındaki nesneleri için `no privileges were granted` uyarıları beklenen davranış; bu nesneler zaten herkese açık.

**Adımlar:**

1. Güçlü bir şifre üretip doğrudan Anahtar Zinciri'ne yazın (şifre ekrana ve kabuk geçmişine düşmüyor):

   ```bash
   security add-generic-password -U -a getirbakim_readonly -s getirbakim-prod-readonly \
     -w "$(openssl rand -base64 32 | tr -d '/+=')"
   ```

2. Yazma yetkili tünelle, repo kökünden dosyayı çalıştırın:

   ```bash
   bash scripts/aws/db-tunnel.sh <profil> --write --psql -- -f scripts/aws/readonly-role.sql
   ```

   Master kullanıcıyla çalıştırmanız gerekiyorsa tüneli `--write` ile açın ve başka bir terminalden, repo kökünde `psql "host=localhost port=15432 dbname=getirbakim user=<master> sslmode=require" -f scripts/aws/readonly-role.sql` komutunu çalıştırın (`psql` master şifresini soruyor).

3. Çıktıyı kontrol edin: `connection_limit` `5`; `settings` sütununda `default_transaction_read_only=on`, `statement_timeout=5min`, `idle_in_transaction_session_timeout=10min`; `unreadable_tables` ve `writable_tables` `0`; varsayılan yetkilerde `r` (tablolar) ve `S` (sequence'ler) satırları.

4. Salt-okunur bağlantıyı deneyin:

   ```bash
   bash scripts/aws/db-tunnel.sh <profil> --psql
   ```

   ```sql
   SELECT count(*) FROM commerce_orders;            -- çalışır
   SHOW default_transaction_read_only;             -- on
   SET default_transaction_read_only = off;
   DELETE FROM commerce_orders WHERE false;        -- permission denied for table commerce_orders
   ```

5. Şifreyi kullanacak kişilere güvenli bir kanaldan iletin; her kişi kendi Anahtar Zinciri'ne ekliyor.
