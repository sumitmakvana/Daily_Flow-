import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/integrations/postgres/client.server";
import { startTaskForUser } from "@/lib/task-start.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageKind = "success" | "info" | "error";

const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const KIND_STYLE: Record<PageKind, { color: string; icon: string }> = {
  success: { color: "#2563eb", icon: "▶" },
  info: { color: "#64748b", icon: "ℹ" },
  error: { color: "#dc2626", icon: "!" },
};

/** Standalone status page shown in place of the clicked email button. No redirect. */
function statusPage(opts: {
  kind: PageKind;
  title: string;
  message: string;
  taskLabel?: string;
  badge?: string;
  origin: string;
  status?: number;
}) {
  const { color, icon } = KIND_STYLE[opts.kind];
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)} - Operon</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f1f5f9; color: #0f172a; }
    .card { text-align: center; padding: 2.5rem 2rem; border-radius: 16px; background: #fff; box-shadow: 0 10px 30px rgba(15,23,42,.08); max-width: 440px; margin: 1rem; border: 1px solid #e2e8f0; }
    .icon { width: 56px; height: 56px; border-radius: 50%; background: ${color}1a; color: ${color}; font-size: 24px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem; }
    h2 { margin: 0 0 .5rem; font-size: 1.25rem; }
    p { margin: 0 0 1rem; color: #64748b; font-size: .95rem; line-height: 1.5; }
    .task { font-weight: 700; color: #0f172a; margin-bottom: 1rem; font-size: .95rem; }
    .btn { display: inline-block; padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600; background: ${color}; color: #fff; }
    .btn[aria-disabled="true"] { opacity: .65; cursor: not-allowed; pointer-events: none; }
    a.link { color: #2563eb; text-decoration: none; font-size: .85rem; display: inline-block; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h2>${esc(opts.title)}</h2>
    ${opts.taskLabel ? `<div class="task">${esc(opts.taskLabel)}</div>` : ""}
    <p>${esc(opts.message)}</p>
    ${opts.badge ? `<span class="btn" aria-disabled="true">${esc(opts.badge)}</span><br>` : ""}
    <a class="link" href="${esc(opts.origin)}/my-day">Open Operon</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: opts.status ?? 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/actions/start-task")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const taskId = url.searchParams.get("taskId");
        const userId = url.searchParams.get("userId");
        const origin = process.env.APP_URL || `${url.protocol}//${url.host}`;

        if (!taskId || !userId || !UUID_RE.test(taskId) || !UUID_RE.test(userId)) {
          return statusPage({
            kind: "error",
            title: "Invalid link",
            message: "This link is invalid or has expired. Please open Operon to start your task.",
            origin,
            status: 400,
          });
        }

        try {
          const pool = getPool();

          const taskRes = await pool.query(
            "SELECT id, task_code, task_name, assigned_to, status FROM public.tasks WHERE id = $1",
            [taskId],
          );
          const task = taskRes.rows[0];

          if (!task) {
            return statusPage({
              kind: "error",
              title: "Task not found",
              message: "This task no longer exists, so the link has expired.",
              origin,
              status: 404,
            });
          }

          const taskLabel = `${task.task_code ? `[${task.task_code}] ` : ""}${task.task_name}`;

          if (task.assigned_to !== userId) {
            return statusPage({
              kind: "error",
              title: "Not allowed",
              message: "This task is not assigned to you.",
              origin,
              status: 403,
            });
          }

          if (task.status === "Completed") {
            return statusPage({
              kind: "info",
              title: "Task already completed",
              taskLabel,
              message: "This task is already completed, so this link has expired.",
              badge: "Completed",
              origin,
            });
          }

          // Same transactional, row-locked start as the push action (single running timer,
          // paused/carried tasks resumable, other tasks keep their status).
          const outcome = await startTaskForUser(userId, taskId, {
            source: "Started directly from email nudge",
            anyOpenStatus: true,
          });
          const alreadyRunning = outcome.result === "already_in_progress";
          if (outcome.result !== "started" && !alreadyRunning) {
            return statusPage({
              kind: "error",
              title: "Could not start task",
              message: outcome.message,
              origin,
              status: 409,
            });
          }

          return statusPage({
            kind: "success",
            title: alreadyRunning ? "Task already in progress" : "Task started",
            taskLabel,
            message:
              alreadyRunning
                ? "This task was already started. Nothing else to do."
                : "Your task is now In Progress and the timer has started.",
            badge: "In Progress",
            origin,
          });
        } catch (err) {
          console.error("Error starting task from email action:", err);
          return statusPage({
            kind: "error",
            title: "Could not start task",
            message: "Something went wrong. Please open Operon and start the task there.",
            origin,
            status: 500,
          });
        }
      },
    },
  },
});
