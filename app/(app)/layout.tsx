import { AppShell } from "@/components/layout/app-shell";
import { getRepository } from "@/lib/data";
import { getDataMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Per-user live data: never prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = getDataMode();
  let userEmail: string | null = null;
  if (mode === "supabase") {
    const { data } = await createSupabaseServerClient().auth.getUser();
    userEmail = data.user?.email ?? null;
  }

  let awaitingReview = 0;
  try {
    awaitingReview = (await getRepository().listClips({ reviewStatuses: ["pending"], pageSize: 1 })).total;
  } catch (err) {
    // Don't take the whole shell down if the count fails; the page will surface the error.
    console.error("[cliphunter] failed to load review count", err);
  }

  return (
    <AppShell mode={mode} userEmail={userEmail} awaitingReview={awaitingReview}>
      {children}
    </AppShell>
  );
}
