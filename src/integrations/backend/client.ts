/**
 * Backend abstraction — browser client.
 *
 * Today this re-exports the Supabase browser client unchanged so 150+
 * existing `.from(...)` / `.rpc(...)` call sites keep working with zero
 * edits. After cutover, `BACKEND_MODE=self` swaps the URL/key via .env;
 * the surface (PostgREST-shaped) is identical because the self-hosted
 * stack runs PostgREST behind the same auth header.
 *
 * Migration rule: NEW code should import from here, not from
 * `@/integrations/supabase/client`. Existing imports are left as-is —
 * they resolve to the same underlying client.
 */
export { supabase } from "@/integrations/supabase/client";
export type { Database } from "@/integrations/supabase/types";
