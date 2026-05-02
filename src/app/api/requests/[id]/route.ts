import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES = ["pending", "contacted", "quoted", "closed", "cancelled"];

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

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Durum güncellenemedi" },
      { status: 500 }
    );
  }
}