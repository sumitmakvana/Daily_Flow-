/**
 * Operational failure recorder. Writes to public.operations_failures so
 * silent catches become visible to admins via the ops_failures admin view.
 * Service-role only; never imported into client code.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface FailureRecord {
  source: string;
  entityType?: string;
  entityId?: string | null;
  errorCode?: string | null;
  errorMessage: string;
  context?: Record<string, unknown>;
}

export async function recordFailure(f: FailureRecord): Promise<void> {
  try {
    await supabaseAdmin.from("operations_failures").insert({
      source: f.source,
      entity_type: f.entityType ?? null,
      entity_id: f.entityId ?? null,
      error_code: f.errorCode ?? null,
      error_message: f.errorMessage.slice(0, 4000),
      context: (f.context ?? {}) as never,
    });
  } catch (e) {
    // Last-resort: never throw from the recorder itself.
    console.error("[ops_failures] recorder failed:", e);
  }
}
