/**
 * Task push notifications (server-only): assignment, started, completed, overdue.
 *
 * Every message has a short title and a two-line body — line 1 is the task name, line 2 the
 * context (who / when). All functions are fire-and-forget safe: they never throw.
 * Pushes are data-only so the Android app can render them natively (branding + Start Task button).
 */
import { getPool } from "@/integrations/postgres/client.server";
import { sendPushToUser, isPushConfigured } from "@/lib/fcm.server";
import { signPushAction } from "@/lib/push-action-token.server";
import { checkIsWorkingDayServer, getUsersOnLeaveTodayServer } from "@/lib/workday-checker.server";

interface TaskRow {
  id: string;
  task_code: string | null;
  task_name: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  reviewer: string | null;
  created_by: string | null;
  actor_id: string | null;
  actor_name: string | null;
  assignee_name: string | null;
}

const TASK_SQL = `
  SELECT t.id, t.task_code, t.task_name, t.status::text AS status, t.priority::text AS priority,
         t.due_date::text AS due_date, t.assigned_to, t.reviewer, t.created_by,
         COALESCE(t.updated_by, t.created_by) AS actor_id,
         actor.display_name AS actor_name, assignee.display_name AS assignee_name
    FROM public.tasks t
    LEFT JOIN public.profiles actor ON actor.id = COALESCE(t.updated_by, t.created_by)
    LEFT JOIN public.profiles assignee ON assignee.id = t.assigned_to`;

async function loadTask(taskId: string): Promise<TaskRow | null> {
  const { rows } = await getPool().query<TaskRow>(`${TASK_SQL} WHERE t.id = $1`, [taskId]);
  return rows[0] ?? null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function taskLabel(t: Pick<TaskRow, "task_code" | "task_name">): string {
  return clip(t.task_code ? `[${t.task_code}] ${t.task_name}` : t.task_name, 80);
}

function shortDate(d: string): string {
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const firstName = (n: string | null | undefined) => (n ? n.trim().split(/\s+/)[0] : null);

function dataFor(type: string, t: TaskRow, extra: Record<string, string | null> = {}) {
  return { type, task_id: t.id, ...extra };
}

/** Task assigned → the assignee. Includes a Start Task button when the task can be started. */
export async function pushTaskAssigned(opts: {
  userId: string;
  taskId: string;
  notificationId?: string;
}): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const t = await loadTask(opts.taskId);
    if (!t) return;
    const by = firstName(t.actor_name);
    const detail = [
      by && t.actor_id !== opts.userId ? `Assigned by ${by}` : "Assigned to you",
      t.due_date ? `Due ${shortDate(t.due_date)}` : null,
      t.priority ? `${t.priority} priority` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    // Start button only if the recipient is the assignee and the task is still to be started.
    const eligible = t.assigned_to === opts.userId && t.status === "To Do";
    const actionToken = eligible ? signPushAction(opts.userId, t.id, "start") : null;

    await sendPushToUser(opts.userId, {
      title: "New task assigned",
      body: `${taskLabel(t)}\n${detail}`,
      display: true,
      data: dataFor("task_assigned", t, {
        notification_id: opts.notificationId ?? null,
        ...(actionToken ? { action: "start", action_token: actionToken } : {}),
      }),
    });
  } catch (e) {
    console.error("[task-push] assigned failed:", (e as Error).message);
  }
}

/** Task started/completed → people who care (assignee, reviewer, creator), never the actor. */
export async function pushTaskProgress(
  kind: "started" | "completed",
  taskId: string,
  actorId: string,
): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const t = await loadTask(taskId);
    if (!t) return;
    const { rows } = await getPool().query<{ display_name: string | null }>(
      "SELECT display_name FROM public.profiles WHERE id = $1",
      [actorId],
    );
    const actor = firstName(rows[0]?.display_name) ?? "Someone";
    const recipients = [...new Set([t.assigned_to, t.reviewer, t.created_by])].filter(
      (id): id is string => !!id && id !== actorId,
    );
    const title = kind === "started" ? "Task started" : "Task completed";
    const verb = kind === "started" ? "started" : "completed";
    const subject =
      t.assigned_to && t.assigned_to !== actorId
        ? `${actor} ${verb} this task for ${firstName(t.assignee_name) ?? "the assignee"}`
        : `${actor} ${verb} this task`;
    await Promise.all(
      recipients.map((uid) =>
        sendPushToUser(uid, {
          title,
          body: `${taskLabel(t)}\n${subject}`,
          display: true,
          data: dataFor(`task_${kind}`, t, { notification_id: `${kind}:${t.id}:${Date.now()}` }),
        }),
      ),
    );
  } catch (e) {
    console.error(`[task-push] ${kind} failed:`, (e as Error).message);
  }
}

const MAX_OVERDUE_PER_USER = 3;

/**
 * Overdue → the assignee, once, on the first working day a task is seen overdue. "Newly overdue"
 * = due on the previous working day or on any non-working day since then. Users on leave are
 * skipped; each user gets at most a few individual pushes plus one summary for the rest.
 */
export async function pushOverdueTasks(todayStr: string): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const dates: string[] = [];
    const cursor = new Date(`${todayStr}T00:00:00Z`);
    for (let i = 0; i < 10; i++) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      const d = cursor.toISOString().slice(0, 10);
      dates.push(d);
      if ((await checkIsWorkingDayServer(d)).isWorkingDay) break;
    }

    const { rows } = await getPool().query<TaskRow>(
      `${TASK_SQL}
        WHERE t.due_date::text = ANY($1::text[])
          AND t.status::text <> 'Completed'
          AND t.assigned_to IS NOT NULL
          AND COALESCE((SELECT is_active FROM public.profiles p WHERE p.id = t.assigned_to), true)
        ORDER BY t.due_date, t.task_name`,
      [dates],
    );
    const onLeave = await getUsersOnLeaveTodayServer(todayStr);
    const byUser = new Map<string, TaskRow[]>();
    for (const t of rows) {
      if (!t.assigned_to || onLeave.has(t.assigned_to)) continue;
      byUser.set(t.assigned_to, [...(byUser.get(t.assigned_to) ?? []), t]);
    }

    for (const [uid, tasks] of byUser) {
      for (const t of tasks.slice(0, MAX_OVERDUE_PER_USER)) {
        const detail = [
          `Was due ${shortDate(t.due_date ?? todayStr)}`,
          t.priority ? `${t.priority} priority` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        await sendPushToUser(uid, {
          title: "Task overdue",
          body: `${taskLabel(t)}\n${detail}`,
          display: true,
          data: dataFor("task_overdue", t, { notification_id: `overdue:${t.id}:${todayStr}` }),
        });
      }
      const rest = tasks.length - MAX_OVERDUE_PER_USER;
      if (rest > 0) {
        await sendPushToUser(uid, {
          title: "More overdue tasks",
          body: `${rest} more task${rest === 1 ? " is" : "s are"} overdue\nOpen Operon to review them`,
          display: true,
          data: {
            type: "task_overdue_summary",
            url: "/my-day",
            notification_id: `overdue-more:${uid}:${todayStr}`,
          },
        });
      }
    }
  } catch (e) {
    console.error("[task-push] overdue failed:", (e as Error).message);
  }
}
