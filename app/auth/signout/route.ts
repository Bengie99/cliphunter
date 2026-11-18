import { NextResponse, type NextRequest } from "next/server";
import { getDataMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (getDataMode() === "supabase") {
    await createSupabaseServerClient().auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
