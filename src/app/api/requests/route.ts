import { NextRequest, NextResponse } from "next/server";

interface ProductSnapshotData {
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

export async function GET() {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("product_requests")
      .select("id, product_id, supplier_product_id, product_snapshot, request_type, customer_name, customer_email, customer_phone, vehicle_info, notes, status, kvkk_consent, kvkk_consent_at, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.kvkk_consent) {
      return NextResponse.json(
        { error: "KVKK onayı zorunludur" },
        { status: 400 }
      );
    }

    if (!body.customer_name || !body.customer_name.trim()) {
      return NextResponse.json(
        { error: "Ad Soyad zorunludur" },
        { status: 400 }
      );
    }

    if (!body.customer_phone || !body.customer_phone.trim()) {
      return NextResponse.json(
        { error: "Telefon numarası zorunludur" },
        { status: 400 }
      );
    }

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const snapshot = body.product_snapshot as ProductSnapshotData | undefined;
    const requestType = body.request_type === "compatibility" ? "compatibility" : "quote";
    const status = "new";

    const insertData: Record<string, unknown> = {
      customer_name: body.customer_name.trim(),
      customer_email: body.customer_email?.trim() || null,
      customer_phone: body.customer_phone.trim(),
      vehicle_info: body.vehicle_info || null,
      notes: body.notes || null,
      status,
      request_type: requestType,
      kvkk_consent: true,
      kvkk_consent_at: new Date().toISOString(),
      product_id: null,
    };

    if (body.supplier_product_id_param) {
      const rawId = String(body.supplier_product_id_param);
      if (rawId.startsWith("db-")) {
        const numId = parseInt(rawId.replace("db-", ""), 10);
        if (!isNaN(numId)) {
          insertData.supplier_product_id = numId;
        }
      }
    }

    if (snapshot) {
      const cleanSnapshot: Record<string, unknown> = {};
      cleanSnapshot.supplier_product_id = snapshot.supplier_product_id ?? null;
      cleanSnapshot.supplier_name = snapshot.supplier_name ?? null;
      cleanSnapshot.supplier_sku = snapshot.supplier_sku ?? null;
      cleanSnapshot.product_name = snapshot.product_name ?? null;
      cleanSnapshot.brand = snapshot.brand ?? null;
      cleanSnapshot.price = snapshot.price ?? null;
      cleanSnapshot.currency = snapshot.currency ?? "TRY";
      cleanSnapshot.stock_quantity = snapshot.stock_quantity ?? null;
      cleanSnapshot.data_source = snapshot.data_source ?? null;
      cleanSnapshot.oem_numbers = Array.isArray(snapshot.oem_numbers) ? snapshot.oem_numbers : [];
      insertData.product_snapshot = cleanSnapshot;
    }

    const { data, error } = await supabase
      .from("product_requests")
      .insert(insertData as never)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const responseData = data as Record<string, unknown>;
    if (responseData.product_snapshot && typeof responseData.product_snapshot === "object" && responseData.product_snapshot !== null) {
      const snapshot = responseData.product_snapshot as Record<string, unknown>;
      delete snapshot.raw_json;
    }

    return NextResponse.json(responseData, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Talep oluşturulamadı" },
      { status: 500 }
    );
  }
}