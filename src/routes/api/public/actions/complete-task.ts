import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/integrations/postgres/client.server";

function htmlRedirectResponse(targetUrl: string, message: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${targetUrl}">
  <title>${message}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
    }
    .card {
      text-align: center;
      padding: 2.5rem 2rem;
      border-radius: 16px;
      background: #1e293b;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      max-width: 420px;
      margin: 1rem;
      border: 1px solid #334155;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { margin: 0 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
    p { margin: 0; color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    a { color: #34d399; text-decoration: none; font-weight: 500; margin-top: 0.75rem; display: inline-block; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>${message}</h2>
    <p>Redirecting to your workspace...</p>
    <a href="${targetUrl}">Click here if you are not redirected automatically</a>
  </div>
  <script>
    window.location.href = ${JSON.stringify(targetUrl)};
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Location: targetUrl,
    },
  });
}

export const Route = createFileRoute("/api/public/actions/complete-task")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const taskId = url.searchParams.get("taskId");
        const userId = url.searchParams.get("userId");
        const origin = process.env.APP_URL || `${url.protocol}//${url.host}`;

        if (!taskId || !userId) {
          return htmlRedirectResponse(
            `${origin}/?toast_error=Invalid link parameters`,
            "Redirecting...",
          );
        }

        try {
          const pool = getPool();

          const taskRes = await pool.query(
            "SELECT id, assigned_to, status FROM public.tasks WHERE id = $1",
            [taskId],
          );
          const task = taskRes.rows[0];

          if (!task) {
            return htmlRedirectResponse(
              `${origin}/?toast_error=Task not found`,
              "Task Not Found",
            );
          }

          if (task.assigned_to !== userId) {
            return htmlRedirectResponse(
              `${origin}/?toast_error=Unauthorized action`,
              "Unauthorized",
            );
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

          return htmlRedirectResponse(
            `${origin}/my-day?toast_message=Task completed successfully!`,
            "Task Completed Successfully!",
          );
        } catch (err) {
          console.error("Error completing task from email action:", err);
          return htmlRedirectResponse(
            `${origin}/?toast_error=Failed to complete task`,
            "Error Completing Task",
          );
        }
      },
    },
  },
});

