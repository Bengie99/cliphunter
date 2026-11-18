import { redirect } from "next/navigation";
import { Crosshair } from "lucide-react";
import { getDataMode } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  // Demo mode has no auth
  if (getDataMode() !== "supabase") redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-6">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/20 text-violet-300">
            <Crosshair className="size-4" />
          </div>
          <div>
            <h1 className="font-semibold leading-tight">ClipHunter</h1>
            <p className="text-xs text-muted-foreground">Private workspace — sign in to continue</p>
          </div>
        </div>
        <LoginForm next={typeof searchParams.next === "string" ? searchParams.next : undefined} />
      </div>
    </div>
  );
}
