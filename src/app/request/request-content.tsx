"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

export default function RequestFormContent() {
  const searchParams = useSearchParams();
  const productId = searchParams.get("productId") ?? "";
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    vehicleInfo: "",
    chassisNumber: "",
    notes: productId ? `Ürün ID: ${productId}` : "",
    kvkkConsent: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.kvkkConsent) return;
    setLoading(true);

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId || null,
          customer_name: form.customerName,
          customer_email: form.customerEmail,
          customer_phone: form.customerPhone || null,
          vehicle_info: form.vehicleInfo
            ? form.chassisNumber
              ? `${form.vehicleInfo} (Şase: ${form.chassisNumber})`
              : form.vehicleInfo
            : form.chassisNumber
              ? `Şase: ${form.chassisNumber}`
              : null,
          notes: form.notes || null,
          kvkk_consent: form.kvkkConsent,
        }),
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
          <svg
            className="w-7 h-7 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-black mb-2">
          Talebiniz Alındı
        </h1>
        <p className="text-gray-500 mb-8">
          En kısa sürede sizinle iletişime geçeceğiz.
        </p>
        <Link
          href="/"
          className="inline-block bg-black text-white px-8 py-3 text-sm font-medium hover:bg-gray-800 transition-colors rounded"
        >
          Ana Sayfaya Dön
        </Link>
      </div>
    );
  }

  const canSubmit = form.kvkkConsent && form.customerName && form.customerEmail;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-black mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Ana Sayfa
      </Link>

      <h1 className="text-2xl font-bold text-black mb-1">Talep Oluştur</h1>
      <p className="text-sm text-gray-500 mb-8">
        Aradığınız parçayı bulamadıysanız, talep oluşturun. Sizin için
        tedarikçilerden fiyat ve stok araştırması yapalım.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="customerName"
            className="block text-sm font-medium text-black mb-1.5"
          >
            Ad Soyad *
          </label>
          <input
            id="customerName"
            type="text"
            required
            value={form.customerName}
            onChange={(e) =>
              setForm({ ...form, customerName: e.target.value })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>

        <div>
          <label
            htmlFor="customerEmail"
            className="block text-sm font-medium text-black mb-1.5"
          >
            E-posta *
          </label>
          <input
            id="customerEmail"
            type="email"
            required
            value={form.customerEmail}
            onChange={(e) =>
              setForm({ ...form, customerEmail: e.target.value })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>

        <div>
          <label
            htmlFor="customerPhone"
            className="block text-sm font-medium text-black mb-1.5"
          >
            Telefon
          </label>
          <input
            id="customerPhone"
            type="tel"
            placeholder="05XX XXX XX XX"
            value={form.customerPhone}
            onChange={(e) =>
              setForm({ ...form, customerPhone: e.target.value })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>

        <div>
          <label
            htmlFor="vehicleInfo"
            className="block text-sm font-medium text-black mb-1.5"
          >
            Araç Bilgisi
          </label>
          <input
            id="vehicleInfo"
            type="text"
            placeholder="Marka, model, yıl, motor"
            value={form.vehicleInfo}
            onChange={(e) =>
              setForm({ ...form, vehicleInfo: e.target.value })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>

        <div>
          <label
            htmlFor="chassisNumber"
            className="block text-sm font-medium text-black mb-1.5"
          >
            Şase No (VIN)
          </label>
          <input
            id="chassisNumber"
            type="text"
            placeholder="Örn: WVGZZZ5NZMW..."
            value={form.chassisNumber}
            onChange={(e) =>
              setForm({ ...form, chassisNumber: e.target.value })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
          <p className="mt-1.5 flex items-start gap-1 text-xs text-gray-500">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Şase no paylaşmanız, doğru parça teyidini hızlandırır. Opsiyonel.
          </p>
        </div>

        <div>
          <label
            htmlFor="notes"
            className="block text-sm font-medium text-black mb-1.5"
          >
            Notlar
          </label>
          <textarea
            id="notes"
            rows={4}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:border-black focus:outline-none focus:ring-0 resize-none"
          />
        </div>

        <div className="border border-gray-200 rounded-md p-4 bg-gray-50">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.kvkkConsent}
              onChange={(e) =>
                setForm({ ...form, kvkkConsent: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-black"
            />
            <span className="text-sm text-gray-700 leading-relaxed">
              <Link
                href="/kvkk"
                className="text-black underline"
                target="_blank"
              >
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
          {loading ? "Gönderiliyor..." : "Talep Gönder"}
        </button>
      </form>
    </div>
  );
}