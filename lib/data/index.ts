import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { getDataMode } from "../env";
import { createSupabaseServerClient } from "../supabase/server";
import { DemoRepository } from "./demo-repo";
import type { ClipRepository } from "./repository";
import { SupabaseRepository } from "./supabase-repo";

let demo: DemoRepository | null = null;

/** Returns the repository for the current request. */
export function getRepository(): ClipRepository {
  noStore(); // data is per-user and always live; never statically cache pages that read it
  if (getDataMode() === "supabase") {
    return new SupabaseRepository(createSupabaseServerClient());
  }
  demo ??= new DemoRepository();
  return demo;
}

export type { ClipRepository } from "./repository";
