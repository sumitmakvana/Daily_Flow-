import { getPool } from "@/integrations/postgres/client.server";
import { sendEodEmail } from "@/services/email-dispatcher";
import {
  getZeroTasksNudgeHtml,
  getUnstartedTasksNudgeHtml,
  getUncompletedEodTasksHtml,
  getGeneralNotificationHtml,
  getMultiTaskAssignmentHtml,
} from "@/services/email-templates";

interface NotificationPayload {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  task_id: string | null;
}

let isListening = false;
const processedDedupeMap = new Map<string, number>();

// In-memory batch queue for grouping multi-task assignments to the same user
const userTaskAssignmentBatches = new Map<
  string,
  {
    payloads: NotificationPayload[];
    timer: NodeJS.Timeout;
  }
>();

function isDuplicateEvent(userId: string, taskId: string | null, title: string): boolean {
  const key = `${userId}:${taskId || ""}:${title}`;
  const now = Date.now();
  const lastProcessed = processedDedupeMap.get(key);

  if (processedDedupeMap.size > 200) {
    for (const [k, time] of processedDedupeMap.entries()) {
      if (now - time > 60000) processedDedupeMap.delete(k);
    }
  }

  if (lastProcessed && now - lastProcessed < 15000) {
    return true;
  }

  processedDedupeMap.set(key, now);
  return false;
}

export function startNotificationListener() {
  if (isListening) return;
  isListening = true;
  console.log("[NotificationListener] Initializing Postgres LISTEN listener for new_notification...");

  const pool = getPool();
  let client: any = null;

  async function connectAndListen() {
    try {
      client = await pool.connect();

      await client.query(`
        CREATE OR REPLACE FUNCTION public.notify_notification_inserted()
        RETURNS TRIGGER AS $$
        BEGIN
          PERFORM pg_notify('new_notification', row_to_json(NEW)::text);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_notification_inserted ON public.notifications;
        CREATE TRIGGER trg_notification_inserted
        AFTER INSERT ON public.notifications
        FOR EACH ROW EXECUTE FUNCTION public.notify_notification_inserted();
      `);

      await client.query("LISTEN new_notification");
      console.log("[NotificationListener] Listening on DB channel: new_notification");

      client.on("notification", (msg: any) => {
        try {
          if (!msg.payload) return;
          const payload = JSON.parse(msg.payload);
          enqueueNotificationPayload(payload);
        } catch (err) {
          console.error("[NotificationListener] Payload error:", err);
        }
      });

      client.on("error", (err: any) => {
        console.error("[NotificationListener] Connection error, reconnecting in 5s...", err.message);
        cleanupAndReconnect();
      });

      client.on("end", () => {
        console.log("[NotificationListener] Connection ended, reconnecting in 5s...");
        cleanupAndReconnect();
      });
    } catch (err) {
      console.error("[NotificationListener] Setup failed, retrying in 5s...", (err as Error).message);
      setTimeout(connectAndListen, 5000);
    }
  }

  function cleanupAndReconnect() {
    if (client) {
      try {
        client.release(true);
      } catch (err) {
        // ignore
      }
      client = null;
    }
    setTimeout(connectAndListen, 5000);
  }

  connectAndListen();
}

function enqueueNotificationPayload(payload: NotificationPayload) {
  if (payload.type === "task_assigned" && payload.task_id) {
    const existing = userTaskAssignmentBatches.get(payload.user_id);
    if (existing) {
      clearTimeout(existing.timer);
      existing.payloads.push(payload);
      existing.timer = setTimeout(() => flushUserAssignmentBatch(payload.user_id), 2000);
    } else {
      const payloads = [payload];
      const timer = setTimeout(() => flushUserAssignmentBatch(payload.user_id), 2000);
      userTaskAssignmentBatches.set(payload.user_id, { payloads, timer });
    }
  } else {
    processSingleNotificationPayload(payload);
  }
}

async function flushUserAssignmentBatch(userId: string) {
  const batch = userTaskAssignmentBatches.get(userId);
  userTaskAssignmentBatches.delete(userId);
  if (!batch || batch.payloads.length === 0) return;

  if (batch.payloads.length === 1) {
    await processSingleNotificationPayload(batch.payloads[0]);
    return;
  }

  // Batch contains multiple task assignments! Group into ONE email.
  try {
    const pool = getPool();
    const origin = process.env.APP_URL || "https://operon.noesisanalytics.co.in";

    const userRes = await pool.query(
      "SELECT email, display_name FROM public.profiles WHERE id = $1",
      [userId],
    );
    const user = userRes.rows[0];
    if (!user || !user.email) return;

    const prefsRes = await pool.query(
      "SELECT * FROM public.notification_prefs WHERE user_id = $1",
      [userId],
    );
    const prefs = prefsRes.rows[0] ?? { notify_assignment: true };
    if (prefs.notify_assignment === false) return;

    const taskIds = batch.payloads.map((p) => p.task_id).filter(Boolean);
    const tasksRes = await pool.query(
      `SELECT t.id, t.task_code, t.task_name, t.priority, assigner.display_name as assigner_name
       FROM public.tasks t
       LEFT JOIN public.profiles assigner ON assigner.id = t.updated_by
       WHERE t.id = ANY($1::uuid[])`,
      [taskIds],
    );

    const tasks = tasksRes.rows;
    if (tasks.length === 0) return;

    const assignerName = tasks[0]?.assigner_name || "Someone";
    const assigneeName = user.display_name || "You";

    const html = getMultiTaskAssignmentHtml(
      userId,
      tasks,
      origin,
      assignerName,
      assigneeName,
    );

    await sendEodEmail({
      to: [user.email.trim().toLowerCase()],
      subject: `🔔 Operon: ${tasks.length} new tasks assigned to you`,
      html,
    });
  } catch (err) {
    console.error("[NotificationListener] Error processing batch email:", err);
  }
}

async function processSingleNotificationPayload(payload: NotificationPayload) {
  if (isDuplicateEvent(payload.user_id, payload.task_id, payload.title)) {
    return;
  }

  const pool = getPool();
  const origin = process.env.APP_URL || "https://operon.noesisanalytics.co.in";

  const userRes = await pool.query(
    "SELECT email, display_name FROM public.profiles WHERE id = $1",
    [payload.user_id],
  );
  const user = userRes.rows[0];
  if (!user || !user.email) return;

  const prefsRes = await pool.query(
    "SELECT * FROM public.notification_prefs WHERE user_id = $1",
    [payload.user_id],
  );
  const prefs = prefsRes.rows[0] ?? {
    digest_enabled: true,
    notify_assignment: true,
    notify_priority_change: true,
    notify_blocker_resolved: true,
  };

  // Ignore eod_team_digest and system log records (handled directly by cron-ticker)
  if (payload.type === "eod_team_digest" || payload.type === "system") return;

  if (payload.type === "task_assigned" && prefs.notify_assignment === false) return;
  if (payload.type === "task_blocked" && prefs.notify_blocker_resolved === false) return;
  if ((payload.type === "sod_digest" || payload.type === "eod_digest") && prefs.digest_enabled === false) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  let html = "";
  let subject = `🔔 Operon: ${payload.title}`;

  if (payload.type === "sod_digest") {
    const tasksRes = await pool.query(
      `SELECT id, task_code, task_name, status, priority, due_date 
       FROM public.tasks 
       WHERE assigned_to = $1 AND (due_date IS NULL OR due_date <= $2)`,
      [payload.user_id, todayStr],
    );
    const userTasks = tasksRes.rows;
    const activeUncompleted = userTasks.filter((t) => t.status !== "Completed");

    if (userTasks.length === 0) {
      subject = "⏰ Start Your Day on Operon";
      html = getZeroTasksNudgeHtml(payload.user_id, origin);
    } else {
      const hasStarted = userTasks.some(
        (t) => t.status === "In Progress" || t.status === "In Review" || t.status === "Completed",
      );
      if (!hasStarted && activeUncompleted.length > 0) {
        subject = "⏰ Action Required: Start your first task today!";
        html = getUnstartedTasksNudgeHtml(payload.user_id, activeUncompleted, origin);
      } else {
        subject = `🔔 Operon: ${payload.title}`;
        html = getGeneralNotificationHtml(payload.title, payload.body || "", payload.task_id, origin);
      }
    }
  } else if (payload.type === "eod_digest") {
    const uncompletedRes = await pool.query(
      `SELECT id, task_code, task_name, status, priority, due_date 
       FROM public.tasks 
       WHERE assigned_to = $1 AND (due_date IS NULL OR due_date <= $2) AND status != 'Completed'`,
      [payload.user_id, todayStr],
    );
    const uncompletedTasks = uncompletedRes.rows;

    if (uncompletedTasks.length > 0) {
      subject = "📊 End of Day Check-in: Update your uncompleted tasks";
    } else {
      subject = "📊 End of Day Check-in: All Tasks Completed! - Operon";
    }
    html = getUncompletedEodTasksHtml(payload.user_id, uncompletedTasks, origin);
  } else {
    subject = `🔔 ${payload.title}${payload.body ? `: ${payload.body}` : ""}`;
    let assignerName = "Operon";
    let assigneeName = user.display_name || "Team Member";
    let taskCode: string | undefined = undefined;
    let taskName: string | undefined = undefined;
    let taskStatus: string = "To Do";

    if (payload.task_id) {
      try {
        const taskInfoRes = await pool.query(
          `SELECT t.task_code, t.task_name, t.status, assigner.display_name as assigner_name
           FROM public.tasks t
           LEFT JOIN public.profiles assigner ON assigner.id = t.updated_by
           WHERE t.id = $1`,
          [payload.task_id],
        );
        const row = taskInfoRes.rows[0];
        if (row) {
          if (row.assigner_name) assignerName = row.assigner_name;
          if (row.task_code) taskCode = row.task_code;
          if (row.task_name) taskName = row.task_name;
          if (row.status) taskStatus = row.status;
        }
      } catch (e) {
        // Fallback
      }
    }

    html = getGeneralNotificationHtml(
      payload.title,
      payload.body || "",
      payload.task_id,
      origin,
      assignerName,
      assigneeName,
      taskCode,
      taskName,
      taskStatus,
    );
  }

  await sendEodEmail({
    to: [user.email.trim().toLowerCase()],
    subject,
    html,
  });
}
