import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("product_requests")
      .select("*")
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

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("product_requests")
      .insert({
        product_id: body.product_id ?? null,
        customer_name: body.customer_name,
        customer_email: body.customer_email,
        customer_phone: body.customer_phone ?? null,
        vehicle_info: body.vehicle_info ?? null,
        notes: body.notes ?? null,
        status: "pending",
        kvkk_consent: true,
        kvkk_consent_at: new Date().toISOString(),
      } as never)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Talep oluşturulamadı" },
      { status: 500 }
    );
  }
}