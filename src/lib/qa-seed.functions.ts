import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SeedResult = {
  email: string;
  role: "admin" | "manager" | "member";
  userId: string;
  created: boolean;
  passwordSet: boolean;
};

/**
 * Seed three QA accounts (admin/manager/member) with deterministic credentials.
 * Admin-only — caller must already hold the admin role.
 * Idempotent: re-running updates the password and ensures the role row exists.
 *
 * Credentials (DO NOT use outside QA / pilot environments):
 *   qa-admin@executionos.test   / QaAdmin!2026
 *   qa-manager@executionos.test / QaManager!2026
 *   qa-member@executionos.test  / QaMember!2026
 */
export const seedQaAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ results: SeedResult[] }> => {
    // Verify caller is admin via has_role
    const { data: caller } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (caller ?? []).some((r) => (r as { role: string }).role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const accounts: { email: string; password: string; role: "admin" | "manager" | "member"; name: string }[] = [
      { email: "qa-admin@executionos.test", password: "QaAdmin!2026", role: "admin", name: "QA Admin" },
      { email: "qa-manager@executionos.test", password: "QaManager!2026", role: "manager", name: "QA Manager" },
      { email: "qa-member@executionos.test", password: "QaMember!2026", role: "member", name: "QA Member" },
    ];

    const results: SeedResult[] = [];
    for (const a of accounts) {
      // Try create; if exists, fetch + update password
      let userId: string | null = null;
      let created = false;
      const createRes = await supabaseAdmin.auth.admin.createUser({
        email: a.email,
        password: a.password,
        email_confirm: true,
        user_metadata: { display_name: a.name },
      });
      if (createRes.data?.user) {
        userId = createRes.data.user.id;
        created = true;
      } else {
        // Lookup existing user
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const found = list?.users?.find((u) => u.email?.toLowerCase() === a.email);
        if (!found) throw new Error(`Could not provision ${a.email}: ${createRes.error?.message ?? "unknown"}`);
        userId = found.id;
        await supabaseAdmin.auth.admin.updateUserById(userId, { password: a.password, email_confirm: true });
      }

      // Ensure role row
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: a.role }, { onConflict: "user_id,role" });

      // Ensure profile row
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: userId, display_name: a.name, email: a.email }, { onConflict: "id" });

      results.push({ email: a.email, role: a.role, userId, created, passwordSet: true });
    }

    return { results };
  });
