import type { Task } from "@/lib/types";

/**
 * Base email layout helper matching the exact Operon UI mockup design.
 */
function getEmailLayout({
  title,
  heroIcon,
  heroTitle,
  heroSubtitle,
  cardContentHtml,
  origin,
}: {
  title: string;
  heroIcon: string;
  heroTitle: string;
  heroSubtitle: string;
  cardContentHtml: string;
  origin: string;
}): string {
  const formattedDate = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8fafc;
            color: #1e293b;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
          }
          .email-wrapper {
            width: 100%;
            background-color: #f8fafc;
            padding: 24px 12px;
          }
          .email-container {
            max-width: 560px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
            border: 1px solid #e2e8f0;
          }
          .header-bar {
            padding: 20px 24px;
            border-bottom: 1px solid #f1f5f9;
          }
          .header-table {
            width: 100%;
            border-collapse: collapse;
          }
          .brand-logo {
            font-size: 18px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.02em;
            vertical-align: middle;
          }
          .brand-icon {
            display: inline-block;
            width: 20px;
            height: 20px;
            background: #2563eb;
            color: #ffffff;
            border-radius: 5px;
            text-align: center;
            line-height: 20px;
            font-size: 12px;
            margin-right: 6px;
            vertical-align: middle;
          }
          .header-date {
            font-size: 13px;
            color: #64748b;
            text-align: right;
            vertical-align: middle;
            font-weight: 500;
          }
          .hero-section {
            text-align: center;
            padding: 32px 24px 24px 24px;
          }
          .hero-circle {
            width: 60px;
            height: 60px;
            background: #eff6ff;
            border-radius: 50%;
            margin: 0 auto 16px auto;
            line-height: 60px;
            font-size: 26px;
            text-align: center;
          }
          .hero-title {
            font-size: 22px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 6px 0;
            letter-spacing: -0.02em;
          }
          .hero-subtitle {
            font-size: 14px;
            color: #64748b;
            margin: 0;
          }
          .main-card-wrap {
            padding: 0 24px 24px 24px;
          }
          .main-card {
            background: #ffffff;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #e2e8f0;
          }
          .help-card {
            background: #ffffff;
            border-radius: 12px;
            padding: 16px 20px;
            margin-top: 16px;
            border: 1px solid #e2e8f0;
          }
          .help-table {
            width: 100%;
            border-collapse: collapse;
          }
          .help-title {
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
            margin: 0 0 2px 0;
          }
          .help-text {
            font-size: 12px;
            color: #64748b;
            margin: 0;
            line-height: 1.4;
          }
          .footer-text {
            text-align: center;
            font-size: 12px;
            color: #94a3b8;
            padding: 16px 0 8px 0;
          }
          .btn-blue {
            display: inline-block;
            background-color: #2563eb;
            color: #ffffff !important;
            padding: 8px 18px;
            font-weight: 600;
            text-decoration: none;
            border-radius: 6px;
            font-size: 13px;
            margin-right: 8px;
          }
          .btn-outline {
            display: inline-block;
            background-color: #ffffff;
            border: 1px solid #cbd5e1;
            color: #334155 !important;
            padding: 8px 18px;
            font-weight: 600;
            text-decoration: none;
            border-radius: 6px;
            font-size: 13px;
          }
          .badge-operon {
            background: #e0e7ff;
            color: #3730a3;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 10px;
            border-radius: 6px;
          }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <!-- Header Bar -->
            <div class="header-bar">
              <table class="header-table">
                <tr>
                  <td class="brand-logo">
                    <span class="brand-icon">✔</span> Operon
                  </td>
                  <td class="header-date">
                    📅 ${formattedDate}
                  </td>
                </tr>
              </table>
            </div>

            <!-- Hero Section -->
            <div class="hero-section">
              <div class="hero-circle">${heroIcon}</div>
              <h1 class="hero-title">${heroTitle}</h1>
              <p class="hero-subtitle">${heroSubtitle}</p>
            </div>

            <!-- Main Content Card -->
            <div class="main-card-wrap">
              <div class="main-card">
                ${cardContentHtml}
              </div>

              <!-- Need Help Box -->
              <div class="help-card">
                <table class="help-table">
                  <tr>
                    <td style="width: 32px; vertical-align: middle; font-size: 20px;">❓</td>
                    <td style="vertical-align: middle;">
                      <h4 class="help-title">Need help?</h4>
                      <p class="help-text">If you have any questions, feel free to reply to this email or contact your administrator.</p>
                    </td>
                    <td style="width: 32px; text-align: right; vertical-align: middle; font-size: 22px;">🎧</td>
                  </tr>
                </table>
              </div>

              <!-- Footer -->
              <div class="footer-text">
                © ${new Date().getFullYear()} Operon. All rights reserved.
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate HTML for Task Assignment (Right side layout in mockup).
 * Route target: /tasks (Task Grid / Tasks view)
 */
export function getGeneralNotificationHtml(
  title: string,
  body: string,
  taskId: string | null,
  origin: string,
  assignerName: string = "Operon",
  assigneeName: string = "Team Member",
  taskCode?: string,
  taskName?: string,
  status: string = "To Do",
): string {
  const isTask = Boolean(taskId || taskName);
  const ctaUrl = taskId ? `${origin}/tasks?taskId=${taskId}` : `${origin}/dashboard`;
  const ctaLabel = isTask ? "View Task" : "Open Operon";

  const displayTaskTitle = taskName
    ? `${taskCode ? `[${taskCode}] ` : ""}${taskName}`
    : body || title;

  const heroTitle = isTask ? "New Task Assigned" : title;
  const heroSubtitle = isTask ? "You have been assigned a new task" : "Notification from Operon";

  const cardHtml = `
    <!-- Assignee / Assigner Bar -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
      <tr>
        <td style="width: 50%; vertical-align: middle;">
          <table style="border-collapse: collapse;">
            <tr>
              <td style="width: 36px; height: 36px; background: #f1f5f9; border-radius: 50%; text-align: center; line-height: 36px; font-size: 16px;">👤</td>
              <td style="padding-left: 8px;">
                <div style="font-size: 11px; color: #64748b;">From</div>
                <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${assignerName}</div>
              </td>
            </tr>
          </table>
        </td>
        <td style="width: 50%; vertical-align: middle;">
          <table style="border-collapse: collapse;">
            <tr>
              <td style="width: 36px; height: 36px; background: #f1f5f9; border-radius: 50%; text-align: center; line-height: 36px; font-size: 16px;">👤</td>
              <td style="padding-left: 8px;">
                <div style="font-size: 11px; color: #64748b;">To</div>
                <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${assigneeName}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Details Section -->
    <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
      ${displayTaskTitle}
    </div>

    ${isTask ? `
    <div style="font-size: 13px; color: #64748b; margin-bottom: 14px;">
      Status: <span style="color: #2563eb; font-weight: 600;">${status}</span>
    </div>

    <div style="background: #f8fafc; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 20px;">
      Please find the task details and start working on it at your earliest convenience.
    </div>
    ` : `
    <div style="background: #f8fafc; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 20px;">
      ${body || title}
    </div>
    `}

    <!-- CTA Button -->
    <div style="text-align: center; margin-bottom: 6px;">
      <a href="${ctaUrl}" class="btn-blue" style="padding: 10px 28px; font-size: 14px; text-decoration: none; border-radius: 6px; display: inline-block;">${ctaLabel}</a>
    </div>
  `;

  return getEmailLayout({
    title: `🔔 Operon: ${title}`,
    heroIcon: isTask ? "📋" : "🔔",
    heroTitle,
    heroSubtitle,
    cardContentHtml: cardHtml,
    origin,
  });
}


/**
 * Generate dedicated HTML email for Leave / WFH applications, status updates, and cancellations
 */
export function getLeaveNotificationHtml(
  title: string,
  body: string,
  type: string,
  origin: string,
): string {
  let heroIcon = "🌴";
  let heroTitle = "Leave Notice";
  let heroSubtitle = "Team member availability update";
  let ctaLabel = "View Calendar";
  let ctaUrl = `${origin}/calendar`;

  if (type === "leave_cancelled") {
    heroIcon = "❌";
    heroTitle = "Leave Request Cancelled";
    heroSubtitle = "A scheduled leave has been cancelled";
  } else if (type === "leave_status_updated") {
    heroIcon = body.toLowerCase().includes("approved") ? "✅" : "ℹ️";
    heroTitle = "Leave Status Updated";
    heroSubtitle = "Your leave request status has been updated";
  } else if (type === "leave_advance_alert") {
    heroIcon = "📅";
    heroTitle = "Tomorrow Leave Reminder";
    heroSubtitle = "Advance team planning alert";
  } else if (title.includes("WFH") || body.includes("WFH")) {
    heroIcon = "🏠";
    heroTitle = "Work From Home Notice";
    heroSubtitle = "Remote work schedule update";
  }

  const cardHtml = `
    <div style="background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; padding: 18px 20px; margin-bottom: 20px;">
      <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
        ${title}
      </div>
      <div style="font-size: 13px; color: #475569; line-height: 1.6;">
        ${body}
      </div>
    </div>

    <!-- CTA Button -->
    <div style="text-align: center; margin-bottom: 8px;">
      <a href="${ctaUrl}" class="btn-blue" style="padding: 10px 28px; font-size: 14px; text-decoration: none; border-radius: 6px; display: inline-block;">${ctaLabel}</a>
      <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">Open Operon to view team availability and manage schedules</div>
    </div>
  `;

  return getEmailLayout({
    title: `${heroIcon} ${title} - Operon`,
    heroIcon,
    heroTitle,
    heroSubtitle,
    cardContentHtml: cardHtml,
    origin,
  });
}


/**
 * Generate HTML for Uncompleted EOD Tasks (Left side layout in mockup).
 * Route target: /my-day for EOD member check-ins
 */
export function getUncompletedEodTasksHtml(
  userId: string,
  tasks: Task[],
  origin: string,
): string {
  if (tasks.length === 0) {
    const cardHtml = `
      <div style="text-align: center; padding: 24px 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; margin-bottom: 12px;">
        <div style="font-size: 36px; margin-bottom: 8px;">🎉</div>
        <div style="font-size: 17px; font-weight: 800; color: #166534; margin-bottom: 6px;">Great Job! 0 Uncompleted Tasks</div>
        <div style="font-size: 13px; color: #15803d; line-height: 1.5;">You have completed all your tasks for today. Have a fantastic evening!</div>
      </div>

      <div style="text-align: center; margin-top: 16px;">
        <a href="${origin}/my-day" class="btn-blue" style="padding: 10px 24px;">View My Day →</a>
      </div>
    `;

    return getEmailLayout({
      title: "EOD Check-in - All Completed! - Operon",
      heroIcon: "🎉",
      heroTitle: "EOD Check-in",
      heroSubtitle: "0 uncompleted tasks — All tasks completed for today!",
      cardContentHtml: cardHtml,
      origin,
    });
  }

  let listHtml = "";
  for (const t of tasks) {
    const codeStr = t.task_code ? `[${t.task_code}] ` : "";
    const completeUrl = `${origin}/api/public/actions/complete-task?taskId=${t.id}&userId=${userId}`;
    const carryUrl = `${origin}/api/public/actions/carry-forward-task?taskId=${t.id}&userId=${userId}`;

    listHtml += `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px;">
        <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">
          ${codeStr}${t.task_name}
        </div>
        <div style="font-size: 12px; color: #64748b; margin-bottom: 10px;">
          Status: <span style="color: #2563eb; font-weight: 600;">${t.status}</span>
        </div>
        <div>
          <a href="${completeUrl}" class="btn-blue">Mark Completed</a>
          <a href="${carryUrl}" class="btn-outline">Carry Forward</a>
        </div>
      </div>
    `;
  }

  const cardHtml = `
    <!-- Top Card Header -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="width: 38px; vertical-align: middle;">
          <div style="width: 34px; height: 34px; background: #eff6ff; border-radius: 8px; text-align: center; line-height: 34px; font-size: 16px;">📋</div>
        </td>
        <td style="vertical-align: middle;">
          <div style="font-size: 15px; font-weight: 700; color: #0f172a;">Uncompleted Tasks</div>
          <div style="font-size: 12px; color: #64748b;">Update directly from this email</div>
        </td>
        <td style="text-align: right; vertical-align: middle;">
          <span class="badge-operon">Operon</span>
        </td>
      </tr>
    </table>

    <!-- Task List with Left Blue Border Accent -->
    <div style="border-left: 3px solid #2563eb; padding-left: 12px;">
      ${listHtml}
    </div>
  `;

  return getEmailLayout({
    title: "EOD Check-in - Operon",
    heroIcon: "📋",
    heroTitle: "EOD Check-in",
    heroSubtitle: "Update your uncompleted tasks for today",
    cardContentHtml: cardHtml,
    origin,
  });
}

/**
 * Generate HTML for multiple task assignments grouped into ONE single email.
 * Route target: /tasks (Main Tasks List & Grid)
 */
export function getMultiTaskAssignmentHtml(
  userId: string,
  tasks: Array<{ id: string; task_code: string | null; task_name: string; priority: string | null }>,
  origin: string,
  assignerName: string = "Operon",
  assigneeName: string = "Team Member",
): string {
  let listHtml = "";
  for (const t of tasks) {
    const codeStr = t.task_code ? `[${t.task_code}] ` : "";
    const ctaUrl = `${origin}/tasks?taskId=${t.id}`;
    listHtml += `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${codeStr}${t.task_name}</div>
              <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Priority: ${t.priority || "Medium"}</div>
            </td>
            <td style="text-align: right; vertical-align: middle; width: 100px;">
              <a href="${ctaUrl}" class="btn-blue" style="padding: 6px 12px; font-size: 12px;">View Task</a>
            </td>
          </tr>
        </table>
      </div>
    `;
  }

  const count = tasks.length;
  const cardHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
      <tr>
        <td style="width: 50%; vertical-align: middle;">
          <table style="border-collapse: collapse;">
            <tr>
              <td style="width: 36px; height: 36px; background: #f1f5f9; border-radius: 50%; text-align: center; line-height: 36px; font-size: 16px;">👤</td>
              <td style="padding-left: 8px;">
                <div style="font-size: 11px; color: #64748b;">Assigned by</div>
                <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${assignerName}</div>
              </td>
            </tr>
          </table>
        </td>
        <td style="width: 50%; vertical-align: middle;">
          <table style="border-collapse: collapse;">
            <tr>
              <td style="width: 36px; height: 36px; background: #f1f5f9; border-radius: 50%; text-align: center; line-height: 36px; font-size: 16px;">👤</td>
              <td style="padding-left: 8px;">
                <div style="font-size: 11px; color: #64748b;">Assigned to</div>
                <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${assigneeName}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="border-left: 3px solid #2563eb; padding-left: 12px;">
      ${listHtml}
    </div>

    <div style="text-align: center; margin-top: 16px;">
      <a href="${origin}/tasks" class="btn-blue" style="padding: 10px 24px; font-size: 13px;">View All Tasks on Operon</a>
    </div>
  `;

  return getEmailLayout({
    title: `🔔 Operon: ${count} new tasks assigned to you`,
    heroIcon: "🔔",
    heroTitle: "New Tasks Assigned",
    heroSubtitle: `You have been assigned ${count} new tasks`,
    cardContentHtml: cardHtml,
    origin,
  });
}

/**
 * Generate HTML for 0 tasks sod nudge.
 * Route target: /today
 */
export function getZeroTasksNudgeHtml(userId: string, origin: string): string {
  const cardHtml = `
    <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">0 Tasks on Plate Today</div>
    <div style="font-size: 13px; color: #64748b; margin-bottom: 14px;">Keeping your task list updated keeps your team aligned.</div>
    <div style="text-align: center; margin-top: 16px;">
      <a href="${origin}/today?openCreateTask=true" class="btn-blue" style="padding: 10px 24px;">Add & Start a Task</a>
    </div>
  `;

  return getEmailLayout({
    title: "Start Your Day on Operon",
    heroIcon: "⏰",
    heroTitle: "Start Your Day",
    heroSubtitle: "You currently have 0 tasks on your plate for today",
    cardContentHtml: cardHtml,
    origin,
  });
}

/**
 * Generate HTML for unstarted tasks nudge.
 * Route target: /today
 */
export function getUnstartedTasksNudgeHtml(userId: string, tasks: Task[], origin: string): string {
  let listHtml = "";
  for (const t of tasks) {
    const codeStr = t.task_code ? `[${t.task_code}] ` : "";
    const startUrl = `${origin}/api/public/actions/start-task?taskId=${t.id}&userId=${userId}`;
    listHtml += `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${codeStr}${t.task_name}</div>
            </td>
            <td style="text-align: right; vertical-align: middle; width: 100px;">
              <a href="${startUrl}" class="btn-blue" style="padding: 6px 12px; font-size: 12px;">Start Task</a>
            </td>
          </tr>
        </table>
      </div>
    `;
  }

  const cardHtml = `
    <div style="border-left: 3px solid #2563eb; padding-left: 12px;">
      ${listHtml}
    </div>
    <div style="text-align: center; margin-top: 16px;">
      <a href="${origin}/today?openCreateTask=true" class="btn-outline" style="padding: 8px 20px;">Or, Add a New Task</a>
    </div>
  `;

  return getEmailLayout({
    title: "Start Your First Task on Operon",
    heroIcon: "⏰",
    heroTitle: "Start Your First Task",
    heroSubtitle: "Select a task below to mark as started:",
    cardContentHtml: cardHtml,
    origin,
  });
}
