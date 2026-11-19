import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledTwitchDiscovery } from "@/lib/discovery/twitch-discovery";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled discovery. Called every 15 min by Supabase pg_cron (see
 * supabase/cron-setup.sql) and once a day by Vercel Cron as a fallback.
 * Both send `Authorization: Bearer <CRON_SECRET>`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const results = await runScheduledTwitchDiscovery(createSupabaseAdminClient());
    return NextResponse.json({
      ok: true,
      twitch: results.map(({ status, seen, added, updated, messages }) => ({ status, seen, added, updated, messages })),
    });
  } catch (err) {
    console.error("[cliphunter] scheduled discovery failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
