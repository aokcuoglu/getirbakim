import { remoteImageUrlMaxLength } from "./product-image-limits";
import type { RemoteImageErrorReason } from "./remote-image-url";

/**
 * What an admin reads when fetching an image from a URL fails (#725); product images and brand logos (#819) differ only
 * in the accepted types and the size limit.
 */
export function remoteImageMessages({ typesText, sizeText }: { typesText: string; sizeText: string }): Record<RemoteImageErrorReason, string> {
  return {
    url: `Geçerli bir http:// veya https:// görsel adresi girin (kullanıcı adı/parola olmadan, en çok ${remoteImageUrlMaxLength} karakter).`,
    port: "Bu bağlantı noktasına izin verilmiyor: yalnız 80, 443, 8080 ve 8443 portlarındaki adresler eklenebilir.",
    blocked: "Bu adrese erişilemez: yalnız internetteki herkese açık adreslerden görsel alınabilir.",
    unreachable: "Adrese ulaşılamadı. Adresi kontrol edip yeniden deneyin.",
    timeout: "Adres zamanında yanıt vermedi. Yeniden deneyin.",
    status: "Adres görseli döndürmedi (sayfa bulunamadı veya erişim reddedildi).",
    "not-image": `Adres bir görsel değil: yalnız ${typesText} görsel adresleri eklenebilir.`,
    size: sizeText,
    redirects: "Adres çok fazla yönlendirme yaptı; görselin doğrudan adresini girin.",
  };
}
