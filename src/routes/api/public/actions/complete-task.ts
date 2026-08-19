import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/integrations/postgres/client.server";

export const Route = createFileRoute("/api/public/actions/complete-task")({
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
            "SELECT id, assigned_to, status FROM public.tasks WHERE id = $1",
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

          const oldStatus = task.status;
          if (oldStatus !== "Completed") {
            await pool.query(
              `UPDATE public.tasks 
               SET status = 'Completed', version = version + 1, completed_at = NOW(), updated_at = NOW(), updated_by = $2 
               WHERE id = $1`,
              [taskId, userId],
            );

            await pool.query(
              `INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment) 
               VALUES ($1, $2, 'Completed', $3, 'Completed directly from email nudge')`,
              [taskId, oldStatus, userId],
            );
          }

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${origin}/my-day?toast_message=Task completed successfully!`,
            },
          });
        } catch (err) {
          console.error("Error completing task from email action:", err);
          return new Response(null, {
            status: 302,
            headers: { Location: `${origin}/?toast_error=Failed to complete task` },
          });
        }
      },
    },
  },
});
