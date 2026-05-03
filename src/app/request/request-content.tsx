"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info, AlertTriangle, Check, Phone, Mail } from "lucide-react";

interface ProductSnapshot {
  supplier_product_id: number | null;
  supplier_name: string | null;
  supplier_sku: string | null;
  product_name: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  stock_quantity: number | null;
  data_source: string | null;
  oem_numbers: string[];
}

export default function RequestFormContent() {
  const searchParams = useSearchParams();
  const supplierProductId = searchParams.get("supplierProductId") ?? "";
  const requestType = searchParams.get("type") ?? "quote";

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(!!supplierProductId);
  const [productSnapshot, setProductSnapshot] = useState<ProductSnapshot | null>(null);
  const [productError, setProductError] = useState<string | null>(null);

  useEffect(() => {
    if (!supplierProductId) {
      setProductLoading(false);
      return;
    }
    setProductLoading(true);
    fetch(`/api/products/${encodeURIComponent(supplierProductId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Ürün bulunamadı");
        return res.json();
      })
      .then((data) => {
        setProductSnapshot(data.snapshot ?? null);
      })
      .catch((err) => {
        setProductError(err.message);
      })
      .finally(() => {
        setProductLoading(false);
      });
  }, [supplierProductId]);

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    vehicleInfo: "",
    chassisNumber: "",
    notes: "",
    kvkkConsent: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.kvkkConsent) return;
    if (!form.customerName.trim() || !form.customerPhone.trim()) return;
    setLoading(true);

    const requestBody: Record<string, unknown> = {
      customer_name: form.customerName.trim(),
      customer_phone: form.customerPhone.trim(),
      customer_email: form.customerEmail.trim() || null,
      vehicle_info: form.vehicleInfo.trim()
        ? form.chassisNumber.trim()
          ? `${form.vehicleInfo.trim()} (Şase: ${form.chassisNumber.trim()})`
          : form.vehicleInfo.trim()
        : form.chassisNumber.trim()
          ? `Şase: ${form.chassisNumber.trim()}`
          : null,
      notes: form.notes.trim() || null,
      kvkk_consent: form.kvkkConsent,
      request_type: requestType,
      status: "new",
    };

    if (supplierProductId) {
      requestBody.supplier_product_id_param = supplierProductId;
    }
    if (productSnapshot) {
      requestBody.product_snapshot = productSnapshot;
    }

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg = data?.error ?? "Talep oluşturulamadı";
        throw new Error(msg);
      }
      setSubmitted(true);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Talep oluşturulurken bir hata oluştu. Lütfen tekrar deneyin."
      );
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <Check className="w-7 h-7 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-black mb-2">
          Talebiniz Alındı
        </h1>
        <p className="text-gray-500 mb-2">
          En kısa sürede sizinle iletişime geçeceğiz.
        </p>
        <p className="text-sm text-gray-400 mb-8">
          Telefon ile dönüş yapılacaktır.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-block bg-black text-white px-8 py-3 text-sm font-medium hover:bg-gray-800 transition-colors rounded"
          >
            Ana Sayfaya Dön
          </Link>
          <Link
            href="/search?q="
            className="inline-block border border-gray-300 text-black px-8 py-3 text-sm font-medium hover:bg-gray-50 transition-colors rounded"
          >
            Yeni Arama Yap
          </Link>
        </div>
      </div>
    );
  }

  const isQuote = requestType === "quote";
  const canSubmit = form.kvkkConsent && form.customerName.trim() && form.customerPhone.trim();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Link
        href={supplierProductId ? `/products/${encodeURIComponent(supplierProductId)}` : "/"}
        className="inline-flex items-center text-sm text-gray-500 hover:text-black mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        {supplierProductId ? "Ürüüne Dön" : "Ana Sayfa"}
      </Link>

      <h1 className="text-2xl font-bold text-black mb-1">
        {isQuote ? "Teklif Al" : "Uyumluluğu Kontrol Et"}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        {isQuote
          ? "Seçtiğiniz ürün için fiyat teklifi alın. Bilgileriniz KVKK kapsamında korunmaktadır."
          : "Aracınıza uyumluluk kontrolü için talep oluşturun. Uyumluluk teyidi sonrası dönüş yapılacaktır."}
      </p>

      {/* Product Summary */}
      {productLoading && (
        <div className="border border-gray-200 rounded-lg p-5 mb-6 animate-pulse bg-gray-50">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
          <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-1/3" />
        </div>
      )}
      {productError && (
        <div className="border border-red-200 rounded-lg p-4 mb-6 bg-red-50">
          <p className="text-sm text-red-700">{productError}</p>
        </div>
      )}
      {productSnapshot && !productLoading && (
        <div className="border border-blue-200 rounded-lg p-5 mb-6 bg-blue-50">
          <h3 className="font-semibold text-sm text-black mb-3">Seçili Ürün</h3>
          {productSnapshot.product_name && (
            <p className="font-medium text-black">{productSnapshot.product_name}</p>
          )}
          <div className="mt-2 space-y-1">
            {productSnapshot.brand && (
              <p className="text-sm text-gray-700">Marka: <span className="font-medium">{productSnapshot.brand}</span></p>
            )}
            {productSnapshot.supplier_name && (
              <p className="text-sm text-gray-700">Tedarikçi: <span className="font-medium">{productSnapshot.supplier_name}</span></p>
            )}
            {productSnapshot.supplier_sku && (
              <p className="text-sm text-gray-700">SKU: <code className="text-xs bg-white px-1.5 py-0.5 rounded font-mono">{productSnapshot.supplier_sku}</code></p>
            )}
            {productSnapshot.price !== null && productSnapshot.price > 0 && (
              <p className="text-sm text-gray-700">
                Fiyat: <span className="font-medium">
                  {new Intl.NumberFormat("tr-TR", { style: "currency", currency: productSnapshot.currency || "TRY" }).format(productSnapshot.price)}
                </span>
              </p>
            )}
            {productSnapshot.stock_quantity !== null && (
              <p className="text-sm text-gray-700">
                Stok: <span className={`font-medium ${productSnapshot.stock_quantity > 0 ? "text-green-700" : "text-red-600"}`}>
                  {productSnapshot.stock_quantity > 0 ? "Stokta" : "Stokta yok"}
                </span>
              </p>
            )}
            {productSnapshot.data_source && (
              <p className="text-xs text-blue-600 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Katalog verisi
              </p>
            )}
            {productSnapshot.oem_numbers && productSnapshot.oem_numbers.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                OEM: {productSnapshot.oem_numbers.slice(0, 3).join(", ")}
                {productSnapshot.oem_numbers.length > 3 && ` +${productSnapshot.oem_numbers.length - 3}`}
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-amber-600">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Fiyat ve stok bilgisi talep öncesinde tekrar doğrulanır.</span>
          </div>
        </div>
      )}

      {/* Trust warning */}
      <div className="border border-gray-200 rounded-lg p-4 mb-6 bg-gray-50">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-gray-600 leading-relaxed">
            Yanlış parça riskini azaltmak için talep sonrası uyumluluk teyidi yapılır.
            {isQuote
              ? " Fiyat ve stok bilgileri sipariş öncesi teyit edilir."
              : " Araç uyumluluğu teknik ekibimiz tarafından kontrol edilir."}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="customerName" className="block text-sm font-medium text-black mb-1.5">
            Ad Soyad *
          </label>
          <input
            id="customerName"
            type="text"
            required
            value={form.customerName}
            onChange={(e) => setForm({ ...form, customerName: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
            placeholder="Adınız Soyadınız"
          />
        </div>

        <div>
          <label htmlFor="customerPhone" className="block text-sm font-medium text-black mb-1.5">
            Telefon *
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              id="customerPhone"
              type="tel"
              required
              value={form.customerPhone}
              onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              className="w-full border border-gray-300 rounded-md pl-10 pr-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
              placeholder="05XX XXX XX XX"
            />
          </div>
        </div>

        <div>
          <label htmlFor="customerEmail" className="block text-sm font-medium text-black mb-1.5">
            E-posta <span className="text-gray-400 font-normal">(opsiyonel)</span>
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              id="customerEmail"
              type="email"
              value={form.customerEmail}
              onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
              className="w-full border border-gray-300 rounded-md pl-10 pr-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
              placeholder="ornek@email.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="vehicleInfo" className="block text-sm font-medium text-black mb-1.5">
            Araç Bilgisi <span className="text-gray-400 font-normal">(opsiyonel)</span>
          </label>
          <input
            id="vehicleInfo"
            type="text"
            placeholder="Marka, model, yıl, motor"
            value={form.vehicleInfo}
            onChange={(e) => setForm({ ...form, vehicleInfo: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>

        <div>
          <label htmlFor="chassisNumber" className="block text-sm font-medium text-black mb-1.5">
            Şase No (VIN) <span className="text-gray-400 font-normal">(opsiyonel)</span>
          </label>
          <input
            id="chassisNumber"
            type="text"
            placeholder="Örn: WVGZZZ5NZMW..."
            value={form.chassisNumber}
            onChange={(e) => setForm({ ...form, chassisNumber: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
          <p className="mt-1.5 flex items-start gap-1 text-xs text-gray-500">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Şase no paylaşmanız, doğru parça teyidini hızlandırır.
          </p>
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-black mb-1.5">
            Notlar
          </label>
          <textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0 resize-none"
            placeholder="Eklemek istediğiniz notlar..."
          />
        </div>

        <div className="border border-gray-200 rounded-md p-4 bg-gray-50">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.kvkkConsent}
              onChange={(e) => setForm({ ...form, kvkkConsent: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-black"
            />
            <span className="text-sm text-gray-700 leading-relaxed">
              <Link href="/kvkk" className="text-black underline" target="_blank">
                KVKK Aydınlatma Metni
              </Link>
              &apos;ni okudum ve kişisel verilerimin işlenmesine izin veriyorum. *
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="w-full bg-black text-white px-6 py-3 text-sm font-medium hover:bg-gray-800 transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Gönderiliyor..." : isQuote ? "Teklif Talep Et" : "Uyumluluk Kontrolü Talep Et"}
        </button>

        <p className="text-xs text-center text-gray-400 mt-3">
          Telefon ile dönüş yapılacaktır &bull; WhatsApp desteği yakında
        </p>
      </form>
    </div>
  );
}