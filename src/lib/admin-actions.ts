import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((userId: string) => userId)
  .handler(async ({ context, data: userIdToDelete }): Promise<{ success: boolean }> => {
    // 1. Verify caller is admin via has_role
    const { data: caller } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    
    const isAdmin = (caller ?? []).some((r) => (r as { role: string }).role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    // Prevent deleting oneself
    if (context.userId === userIdToDelete) {
      throw new Error("Conflict: You cannot delete your own admin account.");
    }

    const isUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const validUuid = isUuid(userIdToDelete);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPool } = await import("@/integrations/postgres/client.server");

    // Dynamic Database Patch to make auth.uid() type-safe for non-UUID subject claims
    // and to fix PL/pgSQL array append syntax in log_task_change() trigger
    try {
      const pool = getPool();
      await pool.query(`
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE plpgsql STABLE AS $$
        DECLARE
          sub_str text;
        BEGIN
          sub_str := current_setting('request.jwt.claim.sub', true);
          IF sub_str IS NULL OR sub_str = '' THEN
            RETURN NULL;
          END IF;
          IF sub_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN sub_str::uuid;
          ELSE
            RETURN NULL;
          END IF;
        END;
        $$;
      `);
      console.log("=== DIAGNOSTIC: auth.uid() database patch successfully applied ===");

      await pool.query(`
        CREATE OR REPLACE FUNCTION public.log_task_change()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        DECLARE
          actor uuid := COALESCE(NEW.updated_by, auth.uid());
          parts text[] := ARRAY[]::text[];
          temp_name text;
        BEGIN
          -- Verify actor exists in profiles to prevent FK constraint violations
          IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = actor) THEN
            actor := NULL;
          END IF;

          IF TG_OP = 'INSERT' THEN
            INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
            VALUES (NEW.id, NULL, NEW.status, actor, 'created');
            RETURN NEW;
          END IF;

          IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
            VALUES (NEW.id, OLD.status, NEW.status, actor, NULL);
          END IF;

          IF OLD.task_name IS DISTINCT FROM NEW.task_name THEN
            parts := array_append(parts, format('name → %s', NEW.task_name));
          END IF;
          
          IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
            IF NEW.assigned_to IS NULL THEN
              parts := array_append(parts, 'assignee → unassigned');
            ELSE
              SELECT display_name INTO temp_name FROM public.profiles WHERE id = NEW.assigned_to;
              parts := array_append(parts, format('assignee → %s', COALESCE(temp_name, 'unknown')));
            END IF;
          END IF;

          IF OLD.priority IS DISTINCT FROM NEW.priority THEN
            parts := array_append(parts, format('priority %s → %s', OLD.priority, NEW.priority));
          END IF;
          
          IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
            parts := array_append(parts, format('due %s → %s', COALESCE(OLD.due_date::text,'—'), COALESCE(NEW.due_date::text,'—')));
          END IF;
          
          IF OLD.reviewer IS DISTINCT FROM NEW.reviewer THEN
            IF NEW.reviewer IS NULL THEN
              parts := array_append(parts, 'reviewer → none');
            ELSE
              SELECT display_name INTO temp_name FROM public.profiles WHERE id = NEW.reviewer;
              parts := array_append(parts, format('reviewer → %s', COALESCE(temp_name, 'unknown')));
            END IF;
          END IF;

          IF array_length(parts,1) IS NOT NULL THEN
            INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
            VALUES (NEW.id, OLD.status, NEW.status, actor, array_to_string(parts, '; '));
          END IF;

          RETURN NEW;
        END;
        $$;
      `);
      console.log("=== DIAGNOSTIC: log_task_change() database patch successfully applied ===");
    } catch (patchErr) {
      console.warn("Could not patch database triggers/functions, proceeding:", patchErr);
    }


    // 2. Perform deletions of uncascaded tables linked to user_id to avoid key conflicts or orphan rows
    // (Only query UUID columns if the ID is a valid UUID format)
    if (validUuid) {
      const { error: errDecisions } = await supabaseAdmin
        .from("approval_decisions")
        .delete()
        .eq("approver_id", userIdToDelete);
      if (errDecisions) throw new Error(`Failed to delete approval decisions: ${errDecisions.message}`);

      const { error: errEod } = await supabaseAdmin
        .from("eod_checkins")
        .delete()
        .eq("user_id", userIdToDelete);
      if (errEod) throw new Error(`Failed to delete EOD checkins: ${errEod.message}`);

      const { error: errWls } = await supabaseAdmin
        .from("daily_workload_snapshot")
        .delete()
        .eq("user_id", userIdToDelete);
      if (errWls) throw new Error(`Failed to delete workload snapshot: ${errWls.message}`);

      const { error: errStreaks } = await supabaseAdmin
        .from("user_streaks")
        .delete()
        .eq("user_id", userIdToDelete);
      if (errStreaks) throw new Error(`Failed to delete streaks: ${errStreaks.message}`);

      const { error: errPrefs } = await supabaseAdmin
        .from("notification_prefs")
        .delete()
        .eq("user_id", userIdToDelete);
      if (errPrefs) throw new Error(`Failed to delete notification preferences: ${errPrefs.message}`);

      const { error: errAdoption } = await supabaseAdmin
        .from("adoption_daily")
        .delete()
        .eq("user_id", userIdToDelete);
      if (errAdoption) throw new Error(`Failed to delete adoption records: ${errAdoption.message}`);

      const { error: errNudges } = await supabaseAdmin
        .from("nudges")
        .delete()
        .eq("user_id", userIdToDelete);
      if (errNudges) throw new Error(`Failed to delete nudges: ${errNudges.message}`);

      // Delete planning suggestions where the user was the initiator, recipient, or resolver
      const { error: errSug1 } = await supabaseAdmin
        .from("planning_suggestions")
        .delete()
        .eq("from_user_id", userIdToDelete);
      if (errSug1) throw new Error(`Failed to delete planning suggestions (from): ${errSug1.message}`);
      
      const { error: errSug2 } = await supabaseAdmin
        .from("planning_suggestions")
        .delete()
        .eq("to_user_id", userIdToDelete);
      if (errSug2) throw new Error(`Failed to delete planning suggestions (to): ${errSug2.message}`);
        
      const { error: errSug3 } = await supabaseAdmin
        .from("planning_suggestions")
        .delete()
        .eq("resolved_by", userIdToDelete);
      if (errSug3) throw new Error(`Failed to delete planning suggestions (resolved): ${errSug3.message}`);
    }

    // 3. Try to delete user from Supabase Auth (only if the ID is a valid UUID)
    let authDeleted = false;
    if (validUuid) {
      try {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(userIdToDelete);
        if (!error) {
          authDeleted = true;
        } else {
          console.warn(`Supabase Auth delete returned error: ${error.message || JSON.stringify(error)}. Falling back to database-only deletion.`);
        }
      } catch (e) {
        console.warn("Supabase Auth delete failed. Falling back to database-only deletion.", e);
      }
    }

    // 4. If not deleted via Auth cascade (e.g. Keycloak mode or custom mock ID), delete manually
    if (!authDeleted) {
      if (validUuid) {
        // Delete from comments (cascades to comment_mentions)
        const { error: errComments } = await supabaseAdmin
          .from("comments")
          .delete()
          .eq("user_id", userIdToDelete);
        if (errComments) throw new Error(`Failed to delete comments: ${errComments.message}`);

        // Delete from notifications
        const { error: errNotifs } = await supabaseAdmin
          .from("notifications")
          .delete()
          .eq("user_id", userIdToDelete);
        if (errNotifs) throw new Error(`Failed to delete notifications: ${errNotifs.message}`);

        // Delete from user_roles
        const { error: errRoles } = await supabaseAdmin
          .from("user_roles")
          .delete()
          .eq("user_id", userIdToDelete);
        if (errRoles) throw new Error(`Failed to delete user roles: ${errRoles.message}`);

        // Delete from user_org_roles
        const { error: errOrgRoles } = await supabaseAdmin
          .from("user_org_roles")
          .delete()
          .eq("user_id", userIdToDelete);
        if (errOrgRoles) throw new Error(`Failed to delete user org roles: ${errOrgRoles.message}`);
      } else {
        // Fallback for non-UUID (mock/seed) roles and comments deletion
        try {
          await supabaseAdmin.from("comments").delete().eq("user_id", userIdToDelete);
        } catch (_) {}
        try {
          await supabaseAdmin.from("notifications").delete().eq("user_id", userIdToDelete);
        } catch (_) {}
        try {
          await supabaseAdmin.from("user_roles").delete().eq("user_id", userIdToDelete);
        } catch (_) {}
        try {
          await supabaseAdmin.from("user_org_roles").delete().eq("user_id", userIdToDelete);
        } catch (_) {}
      }

      // Delete from profiles (which must be TEXT/VARCHAR if "admin" is stored there)
      const { error: errProfiles } = await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", userIdToDelete);
      if (errProfiles) throw new Error(`Failed to delete profile: ${errProfiles.message}`);
    }

    return { success: true };
  });
