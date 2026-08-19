import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/integrations/postgres/client.server";

export const Route = createFileRoute("/api/public/actions/start-task")({
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

          // Fetch task
          const taskRes = await pool.query(
            "SELECT id, task_code, task_name, assigned_to, status FROM public.tasks WHERE id = $1",
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
          if (oldStatus !== "In Progress") {
            await pool.query(
              `UPDATE public.tasks 
               SET status = 'In Progress', version = version + 1, updated_at = NOW(), updated_by = $2 
               WHERE id = $1`,
              [taskId, userId],
            );

            await pool.query(
              `INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment) 
               VALUES ($1, $2, 'In Progress', $3, 'Started directly from email nudge')`,
              [taskId, oldStatus, userId],
            );
          }

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${origin}/my-day?taskId=${taskId}&toast_message=Task started successfully!`,
            },
          });
        } catch (err) {
          console.error("Error starting task from email action:", err);
          return new Response(null, {
            status: 302,
            headers: { Location: `${origin}/?toast_error=Failed to start task` },
          });
        }
      },
    },
  },
});
