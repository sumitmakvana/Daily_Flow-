import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/integrations/postgres/client.server";

export const Route = createFileRoute("/api/public/actions/carry-forward-task")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const taskId = url.searchParams.get("taskId");
        const userId = url.searchParams.get("userId");
        const origin = process.env.APP_URL || `${url.protocol}//${url.host}`;

        if (!taskId || !userId) {
          return new Response(null, {
            status: 302,
            headers: { Location: `${origin}/?toast_error=Invalid link parameters` },
          });
        }

        try {
          const pool = getPool();

          const taskRes = await pool.query(
            "SELECT id, assigned_to, status, version FROM public.tasks WHERE id = $1",
            [taskId],
          );
          const task = taskRes.rows[0];

          if (!task) {
            return new Response(null, {
              status: 302,
              headers: { Location: `${origin}/?toast_error=Task not found` },
            });
          }

          if (task.assigned_to !== userId) {
            return new Response(null, {
              status: 302,
              headers: { Location: `${origin}/?toast_error=Unauthorized action` },
            });
          }

          // Get next working day via DB function
          const nwdRes = await pool.query("SELECT public.next_working_day(CURRENT_DATE) as nwd");
          const nextWorkingDay = nwdRes.rows[0]?.nwd;
          const targetDateStr = nextWorkingDay
            ? new Date(nextWorkingDay).toISOString().slice(0, 10)
            : new Date(Date.now() + 86400000).toISOString().slice(0, 10);

          // Execute carry_task_forward RPC
          await pool.query(
            "SELECT * FROM public.carry_task_forward($1::uuid, $2::date, 'manual', $3::int)",
            [taskId, targetDateStr, task.version],
          );

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${origin}/my-day?toast_message=Task carried forward to ${targetDateStr}!`,
            },
          });
        } catch (err) {
          console.error("Error carrying forward task from email action:", err);
          return new Response(null, {
            status: 302,
            headers: { Location: `${origin}/?toast_error=Failed to carry forward task` },
          });
        }
      },
    },
  },
});
