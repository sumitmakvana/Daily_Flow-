import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

/**
 * What the New Task form needs from past tasks, computed in the database.
 *
 * It used to read `tasks?select=assigned_to,client,project_name&order=created_at.desc&limit=1000` (about 100 kB:
 * 1000 rows, each with a full UUID and two strings) only to derive two small things on the client:
 *   - each person's most recent client / project  (prefilled when an assignee is chosen)
 *   - the distinct project / client pairs         (project and client suggestions)
 * Here the same two results come out of the same newest-`limit` window, already reduced: one row per assignee
 * and one row per distinct pair (a few kB). Same window, same ordering, same "first seen = newest wins" rule.
 *
 * Runs as the signed-in user (SET LOCAL role authenticated + their claims), so row-level security hides
 * exactly the tasks the REST read hid.
 */
export type TaskNameHintsPayload = {
  lastByAssignee: Record<string, { client: string; project_name: string }>;
  pairs: Array<{ project_name: string; client: string | null }>;
};

const RECENT = `recent AS (
  SELECT assigned_to, client, project_name, created_at
    FROM public.tasks
   ORDER BY created_at DESC
   LIMIT $1
)`;

export const fetchTaskNameHintsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d?: { limit?: number }) => z.object({ limit: z.number().int().min(1).max(5000).optional() }).optional().parse(d))
  .handler(async ({ data, context }): Promise<TaskNameHintsPayload> => {
    const limit = data?.limit ?? 1000;
    return withUser(context.userId, async (client) => {
      const [last, pairs] = await Promise.all([
        // newest task per assignee within the window
        client.query<{ assigned_to: string; client: string | null; project_name: string | null }>(
          `WITH ${RECENT}
           SELECT DISTINCT ON (assigned_to) assigned_to, client, project_name
             FROM recent
            WHERE assigned_to IS NOT NULL
            ORDER BY assigned_to, created_at DESC`,
          [limit],
        ),
        // distinct (project, client) pairs, newest first; a null client and "" are the same pair
        client.query<{ project_name: string; client: string | null }>(
          `WITH ${RECENT}
           SELECT project_name, client FROM (
             SELECT DISTINCT ON (project_name, COALESCE(client, '')) project_name, client, created_at
               FROM recent
              WHERE btrim(project_name) <> ''
              ORDER BY project_name, COALESCE(client, ''), created_at DESC
           ) d
           ORDER BY created_at DESC`,
          [limit],
        ),
      ]);
      const lastByAssignee: TaskNameHintsPayload["lastByAssignee"] = {};
      for (const r of last.rows) lastByAssignee[r.assigned_to] = { client: r.client || "", project_name: r.project_name || "" };
      return { lastByAssignee, pairs: pairs.rows };
    });
  });
