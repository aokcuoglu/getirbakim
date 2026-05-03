import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES = ["new", "reviewing", "contacted", "quoted", "converted", "cancelled"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: "Geçersiz durum. Geçerli değerler: " + VALID_STATUSES.join(", ") },
        { status: 400 }
      );
    }

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("product_requests")
      .update({ status: body.status, updated_at: new Date().toISOString() } as never)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 });
    }

    const responseData = data as Record<string, unknown>;
    if (responseData.product_snapshot && typeof responseData.product_snapshot === "object" && responseData.product_snapshot !== null) {
      const snapshot = responseData.product_snapshot as Record<string, unknown>;
      delete snapshot.raw_json;
    }

    return NextResponse.json(responseData);
  } catch {
    return NextResponse.json(
      { error: "Durum güncellenemedi" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("product_requests")
      .select("id, product_id, supplier_product_id, product_snapshot, request_type, customer_name, customer_email, customer_phone, vehicle_info, notes, status, kvkk_consent, kvkk_consent_at, created_at, updated_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 });
    }

    const responseData = data as Record<string, unknown>;
    if (responseData.product_snapshot && typeof responseData.product_snapshot === "object" && responseData.product_snapshot !== null) {
      const snapshot = responseData.product_snapshot as Record<string, unknown>;
      delete snapshot.raw_json;
    }

    return NextResponse.json(responseData);
  } catch {
    return NextResponse.json({ error: "Talep bulunamadı" }, { status: 500 });
  }
}