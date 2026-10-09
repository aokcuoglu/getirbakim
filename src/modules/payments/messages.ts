// Shared by the order page and the payment dialog; codes come from startPayment.
export const paymentErrors: Record<string, string> = {
  provider: "Ödeme sayfası şu anda açılamadı. Birkaç dakika sonra yeniden dene.",
  expired: "Ödeme süresi doldu; sipariş iptal edildi. Sepetinden yeniden sipariş oluşturabilirsin.",
  limit: "Bu sipariş için ödeme deneme sınırına ulaşıldı. Sepetinden yeni sipariş oluştur veya bizimle iletişime geç.",
  disabled: "Online ödeme şu anda kapalı.",
  closed: "Bu sipariş için ödeme alınamıyor.",
  paid: "Bu siparişin ödemesi zaten alındı.",
};

/** Name of the window TAMI's hosted page opens in; the return page only talks to an opener through it. */
export const PAYMENT_WINDOW = "getirbakim-tami";
