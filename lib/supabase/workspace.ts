import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The caller's team workspace id (the workspace owner's user id, or their own id
 * if they aren't in a team). All shared rows and Storage paths use this, never
 * the signed-in user's own id. Defined in migration 20261125000000_team.sql.
 */
export async function getWorkspaceId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.rpc("workspace_id");
  if (error || !data) throw new Error(`Couldn't load your workspace: ${error?.message ?? "no workspace"}. Has the team migration been run?`);
  return data as string;
}
