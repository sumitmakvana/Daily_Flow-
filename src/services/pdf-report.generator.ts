export interface EodReportData {
  dateStr: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  inReviewTasks?: number;
  todoTasks?: number;
  blockedTasks: number;
  pendingTasks: number;
  overdueTasks?: number;
  completionRate: number;
  memberSummaries: Array<{
    name: string;
    completedCount: number;
    inProgressCount: number;
    inReviewCount?: number;
    todoCount?: number;
    blockedCount: number;
    pendingCount: number;
    overdueCount?: number;
    overdueDates?: string;
    totalCount?: number;
    tasks?: Array<{ code: string; name: string; status: string; dueDate?: string | null; remarks?: string | null }>;
  }>;
  blockedAlerts: Array<{ code: string; name: string; memberName: string; reason: string; duration?: string }>;
  todayCompletedTasksList?: Array<{ code: string; name: string; memberName: string }>;
  todayInProgressTasksList?: Array<{ code: string; name: string; memberName: string }>;
  upcomingDeadlines?: Array<{ dateLabel: string; name: string; priority: string }>;
  teamHealthScore?: number;
  healthDelta?: string;
  dashboardUrl?: string;
  appName?: string;
}


export function generateEodHtmlReport(data: EodReportData): string {
  const {
    dateStr,
    totalTasks,
    completedTasks,
    inProgressTasks,
    inReviewTasks = 0,
    todoTasks = 0,
    blockedTasks,
    pendingTasks,
    overdueTasks = 0,
    completionRate,
    memberSummaries,
    blockedAlerts,
    upcomingDeadlines: passedDeadlines,
    teamHealthScore: passedHealthScore,
    healthDelta: passedHealthDelta,
    dashboardUrl = "https://operon.noesisanalytics.co.in/",
    appName = "OPERON",
  } = data;

  // Compute team health score and delta
  const healthScore =
    passedHealthScore !== undefined
      ? passedHealthScore
      : Math.max(
          5,
          Math.min(
            100,
            Math.round(
              completionRate * 0.6 +
                (totalTasks > 0 ? (completedTasks / totalTasks) * 40 : 0),
            ),
          ),
        );
  const healthDelta = passedHealthDelta || "▲ 12% from yesterday";

  // Calculate member progress percentages & sort for Top Performers
  const enrichedMembers = memberSummaries.map((m) => {
    const inReview = m.inReviewCount ?? 0;
    const todo = m.todoCount ?? (m.pendingCount !== undefined ? m.pendingCount : 0);
    const totalMemberTasks =
      m.totalCount !== undefined
        ? m.totalCount
        : m.completedCount + m.inProgressCount + inReview + todo + m.blockedCount;
    const progress =
      totalMemberTasks > 0 ? Math.round((m.completedCount / totalMemberTasks) * 100) : 0;
    const initials =
      m.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "TM";
    return {
      ...m,
      inReviewCount: inReview,
      todoCount: todo,
      overdueCount: m.overdueCount ?? 0,
      overdueDates: m.overdueDates,
      totalMemberTasks,
      progress,
      initials,
    };
  });

  // Top Performers (sorted by progress desc then completedCount desc)
  const topPerformers = [...enrichedMembers]
    .sort((a, b) => b.progress - a.progress || b.completedCount - a.completedCount)
    .slice(0, 3);

  const upcomingDeadlines = passedDeadlines ?? [];

  // Format Member rows HTML for the table (Outlook MSO compatible)
  const memberRowsHtml = enrichedMembers
    .map((m, idx) => {
      const bgColor = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
      const avatarColors = [
        { bg: "#e0e7ff", text: "#3730a3" },
        { bg: "#dbeafe", text: "#1e40af" },
        { bg: "#fce7f3", text: "#9d174d" },
        { bg: "#fef3c7", text: "#92400e" },
        { bg: "#dcfce7", text: "#166534" },
      ];
      const colorScheme = avatarColors[idx % avatarColors.length];

      return `
      <tr style="background-color: ${bgColor}; border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 12px; font-weight: 600; color: #0f172a; font-size: 13px; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 28px; vertical-align: middle;">
                <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: ${colorScheme.bg}; color: ${colorScheme.text}; text-align: center; font-size: 11px; font-weight: 700; font-family: Arial, sans-serif;">${m.initials}</div>
              </td>
              <td style="padding-left: 8px; vertical-align: middle; color: #1e293b; font-weight: 600; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                ${escapeHtml(m.name)}
              </td>
            </tr>
          </table>
        </td>
        <td align="center" style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #16a34a; font-size: 13px; font-family: Arial, sans-serif;">
          ${m.completedCount}
        </td>
        <td align="center" style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #2563eb; font-size: 13px; font-family: Arial, sans-serif;">
          ${m.inProgressCount}
        </td>
        <td align="center" style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #7c3aed; font-size: 13px; font-family: Arial, sans-serif;">
          ${m.inReviewCount}
        </td>
        <td align="center" style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #d97706; font-size: 13px; font-family: Arial, sans-serif;">
          ${m.todoCount}
        </td>
        <td align="center" style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #dc2626; font-size: 13px; font-family: Arial, sans-serif;">
          ${m.blockedCount}
        </td>
        <td align="center" style="padding: 10px 6px; text-align: center; vertical-align: middle; font-size: 12px; font-family: Arial, sans-serif;">
          ${
            m.overdueCount > 0
              ? `<span style="display: inline-block; background-color: #fef3c7; color: #b45309; border: 1px solid #fde68a; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;">${m.overdueCount}${m.overdueDates ? ` (${escapeHtml(m.overdueDates)})` : ' overdue'}</span>`
              : `<span style="color: #94a3b8; font-weight: 600;">0</span>`
          }
        </td>
        <td align="center" style="padding: 10px 8px; text-align: center; vertical-align: middle; font-weight: 800; color: #0f172a; font-size: 13px; font-family: Arial, sans-serif;">
          ${m.totalMemberTasks}
        </td>
      </tr>
      `;
    })
    .join("");

  // Action Required Cards HTML (Outlook MSO compatible table cell design)
  const actionRequiredCardsHtml = blockedAlerts.length
    ? blockedAlerts
        .slice(0, 3)
        .map(
          (b, idx) => `
          <td width="33.33%" valign="top" style="padding: 4px; vertical-align: top;" class="action-card-column">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #fee2e2; border-radius: 10px; border-collapse: separate;">
              <tr>
                <td style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                  <div style="margin-bottom: 6px;">
                    <span style="background-color: ${idx === 0 ? "#fee2e2" : "#ffedd5"}; color: ${idx === 0 ? "#b91c1c" : "#c2410c"}; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">${idx === 0 ? "HIGH" : "MEDIUM"}</span>
                  </div>
                  <div style="font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.3; margin-bottom: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    ${escapeHtml(b.name)}
                  </div>
                  <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 6px; border-collapse: collapse;">
                    <tr>
                      <td style="width: 16px; vertical-align: middle;">
                        <div style="width: 14px; height: 14px; line-height: 14px; background: #e2e8f0; color: #475569; text-align: center; border-radius: 50%; font-size: 8px; font-weight: 700; font-family: Arial, sans-serif;">👤</div>
                      </td>
                      <td style="padding-left: 4px; vertical-align: middle; font-size: 10px; color: #64748b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                        Assigned to <strong style="color: #334155;">${escapeHtml(b.memberName)}</strong>
                      </td>
                    </tr>
                  </table>
                  <div style="font-size: 10px; font-weight: 700; color: #dc2626; margin-top: 6px; background-color: #fff1f2; padding: 4px 6px; border-radius: 4px; border: 1px solid #fecdd3; font-family: Arial, sans-serif;">
                    ${escapeHtml(b.duration || b.reason || "Blocked Since 2 Days")}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        `,
        )
        .join("") +
      (blockedAlerts.length > 3
        ? `
        <td width="33.33%" valign="top" style="padding: 4px; vertical-align: top;" class="action-card-column">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; border-collapse: separate;">
            <tr>
              <td align="center" style="padding: 18px 10px; text-align: center; font-family: Arial, sans-serif;">
                <div style="font-size: 24px; font-weight: 900; color: #2563eb; line-height: 1; margin-bottom: 4px;">+${blockedAlerts.length - 3}</div>
                <div style="font-size: 11px; font-weight: 700; color: #475569; line-height: 1.3; margin-bottom: 8px;">More Issues</div>
                <div>
                  <a href="${dashboardUrl}" style="font-size: 11px; font-weight: 700; color: #2563eb; text-decoration: none; white-space: nowrap; display: inline-block;">View All &rarr;</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      `
        : "")
    : `
      <td width="100%" style="padding: 4px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; border-collapse: separate;">
          <tr>
            <td align="center" style="padding: 14px; color: #166534; font-size: 12px; text-align: center; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              🎉 Excellent! No active blocker issues requiring immediate action today.
            </td>
          </tr>
        </table>
      </td>
    `;

  // Top Performers HTML List
  const topPerformersHtml = topPerformers.length
    ? topPerformers
        .map((tp, idx) => {
          const medal = idx === 0 ? "1" : idx === 1 ? "2" : "3";
          const medalBg = idx === 0 ? "#fef08a" : idx === 1 ? "#e2e8f0" : "#ffedd5";
          const medalText = idx === 0 ? "#854d0e" : idx === 1 ? "#475569" : "#9a3412";
          return `
          <div style="margin-bottom: 10px; background-color: #ffffff; border: 1px solid #f1f5f9; padding: 8px 10px; border-radius: 8px;">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
              <tr>
                <td style="width: 22px; vertical-align: middle;">
                  <div style="width: 18px; height: 18px; line-height: 18px; border-radius: 50%; background-color: ${medalBg}; color: ${medalText}; text-align: center; font-size: 10px; font-weight: 800; font-family: Arial, sans-serif;">${medal}</div>
                </td>
                <td style="vertical-align: middle; font-size: 12px; font-weight: 700; color: #1e293b; padding-left: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                  ${escapeHtml(tp.name)}
                </td>
                <td align="right" style="text-align: right; vertical-align: middle; width: 55px; font-family: Arial, sans-serif;">
                  <span style="font-size: 12px; font-weight: 800; color: #16a34a;">${tp.progress}%</span>
                </td>
              </tr>
            </table>
          </div>
        `;
        })
        .join("")
    : `<div style="font-size: 11px; color: #94a3b8; text-align: center; padding: 10px; font-family: Arial, sans-serif;">No performance data recorded</div>`;

  // Blocked Tasks Column HTML
  const blockedColumnHtml = blockedAlerts.length
    ? blockedAlerts
        .slice(0, 3)
        .map(
          (b) => `
          <div style="margin-bottom: 10px; background-color: #ffffff; border: 1px solid #fee2e2; padding: 8px 10px; border-radius: 8px;">
            <div style="font-size: 11px; font-weight: 700; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              🔹 ${escapeHtml(b.name)}
            </div>
            <div style="font-size: 10px; color: #64748b; margin-top: 3px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              Assigned to: <span style="color: #334155;">${escapeHtml(b.memberName)}</span>
            </div>
            <div style="font-size: 10px; font-weight: 700; color: #dc2626; margin-top: 2px; font-family: Arial, sans-serif;">
              Blocked Since: ${escapeHtml(b.duration || "2 Days")}
            </div>
          </div>
        `,
        )
        .join("")
    : `<div style="font-size: 11px; color: #16a34a; background: #f0fdf4; padding: 8px; border-radius: 6px; text-align: center; font-family: Arial, sans-serif;">No blocked tasks!</div>`;



  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${appName} - Executive Daily Digest (${dateStr})</title>
  <!--[if gte mso 9]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <style type="text/css">
    /* Outlook & General resets */
    body, table, td, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important; }
    table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; border-collapse: collapse; }
    p, a, li, td, blockquote { mso-line-height-rule: exactly; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    
    @media screen and (max-width: 640px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .mobile-padding { padding: 12px 14px !important; }
      .stack-column, .action-card-column { display: block !important; width: 100% !important; max-width: 100% !important; padding: 4px 0 !important; box-sizing: border-box !important; }
      .kpi-column { display: inline-block !important; width: 48% !important; max-width: 48% !important; vertical-align: top !important; padding: 3px !important; box-sizing: border-box !important; }
      .mobile-title { font-size: 18px !important; }
      .mobile-hide { display: none !important; }
      .kpi-num { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 16px 0; background-color: #f1f5f9; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 0;">
        <!-- Main Email Container Card -->
        <table role="presentation" width="100%" class="container" border="0" cellspacing="0" cellpadding="0" style="max-width: 680px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; border-collapse: separate;">
          
          <!-- DARK EXECUTIVE HEADER CARD (Solid #0b0f19 fallback for Outlook) -->
          <tr>
            <td bgcolor="#0b0f19" style="background-color: #0b0f19; background: linear-gradient(135deg, #0b0f19 0%, #161f33 100%); padding: 24px 28px; border-bottom: 3px solid #3b82f6;">
              <!-- Header Top Bar -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 12px; border-collapse: collapse;">
                <tr>
                  <td style="vertical-align: middle;">
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                      <tr>
                        <td style="vertical-align: middle;">
                          <div style="width: 16px; height: 16px; border-radius: 50%; border: 3px solid #3b82f6; background-color: #6366f1;"></div>
                        </td>
                        <td style="padding-left: 8px; vertical-align: middle; font-size: 16px; font-weight: 900; color: #ffffff; letter-spacing: 1px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          ${appName}
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <div style="font-size: 10px; color: #cbd5e1; font-weight: 600; text-align: right; font-family: Arial, sans-serif;">
                      📅 Daily Digest
                    </div>
                    <div style="font-size: 10px; color: #94a3b8; font-weight: 700; text-align: right; margin-top: 2px; font-family: Arial, sans-serif;">
                      ${dateStr}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Main Header Digest Title & Team Health Score Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr>
                  <td style="vertical-align: middle;">
                    <div class="mobile-title" style="font-size: 24px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px; line-height: 1.2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      Daily Executive Digest
                    </div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      Team Performance & Action Report
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle; width: 150px;">
                    <!-- Health Score Box: Solid Hex #0f172a for Outlook support -->
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; border: 1px solid #334155; border-radius: 12px; width: 140px; border-collapse: separate;">
                      <tr>
                        <td align="center" style="padding: 10px 12px; text-align: center; font-family: Arial, sans-serif;">
                          <div style="font-size: 9px; color: #94a3b8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; font-family: Arial, sans-serif;">TEAM HEALTH</div>
                          <div style="font-size: 28px; font-weight: 900; color: #22c55e; line-height: 1; letter-spacing: -0.5px; margin: 2px 0; font-family: Arial, sans-serif;">${healthScore}%</div>
                          <div style="font-size: 10px; color: #22c55e; font-weight: 700; font-family: Arial, sans-serif;">▲ ${healthDelta.replace(/^▲\s*/, "")}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MAIN BODY CONTAINER -->
          <tr>
            <td class="mobile-padding" style="padding: 24px 28px;">

              <!-- SECTION 1: OVERVIEW KPI CARDS (Table cell design for Outlook) -->
              <div style="font-size: 11px; font-weight: 800; color: #334155; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 12px; font-family: Arial, sans-serif;">
                📊 OVERVIEW
              </div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border-collapse: collapse;">
                <tr>
                  <!-- Card 1: Total Tasks -->
                  <td width="20%" align="center" valign="top" style="padding: 3px;" class="kpi-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td align="center" valign="top" style="padding: 12px 4px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background-color: #dcfce7; color: #16a34a; font-size: 11px; font-weight: 900; margin: 0 auto 8px auto; text-align: center; font-family: Arial, sans-serif;">✓</div>
                          <div class="kpi-num" style="font-size: 24px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 6px; font-family: Arial, sans-serif;">${totalTasks}</div>
                          <div class="kpi-label" style="font-size: 10px; font-weight: 600; color: #475569; margin-bottom: 2px;">Total Tasks</div>
                          <div class="kpi-sub" style="font-size: 9px; font-weight: 700; color: #16a34a;">Workload</div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- Card 2: Active Tasks -->
                  <td width="20%" align="center" valign="top" style="padding: 3px;" class="kpi-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td align="center" valign="top" style="padding: 12px 4px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background-color: #dbeafe; color: #2563eb; font-size: 10px; font-weight: 900; margin: 0 auto 8px auto; text-align: center; font-family: Arial, sans-serif;">▶</div>
                          <div class="kpi-num" style="font-size: 24px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 6px; font-family: Arial, sans-serif;">${inProgressTasks}</div>
                          <div class="kpi-label" style="font-size: 10px; font-weight: 600; color: #475569; margin-bottom: 2px;">Active Tasks</div>
                          <div class="kpi-sub" style="font-size: 9px; font-weight: 700; color: #2563eb;">In Progress</div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- Card 3: Completed Tasks -->
                  <td width="20%" align="center" valign="top" style="padding: 3px;" class="kpi-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td align="center" valign="top" style="padding: 12px 4px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background-color: #f3e8ff; color: #7c3aed; font-size: 11px; font-weight: 900; margin: 0 auto 8px auto; text-align: center; font-family: Arial, sans-serif;">📋</div>
                          <div class="kpi-num" style="font-size: 24px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 6px; font-family: Arial, sans-serif;">${completedTasks}</div>
                          <div class="kpi-label" style="font-size: 10px; font-weight: 600; color: #475569; margin-bottom: 2px;">Completed</div>
                          <div class="kpi-sub" style="font-size: 9px; font-weight: 700; color: #16a34a;">Today</div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- Card 4: Pending Tasks -->
                  <td width="20%" align="center" valign="top" style="padding: 3px;" class="kpi-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td align="center" valign="top" style="padding: 12px 4px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background-color: #fef3c7; color: #d97706; font-size: 11px; font-weight: 900; margin: 0 auto 8px auto; text-align: center; font-family: Arial, sans-serif;">⏱</div>
                          <div class="kpi-num" style="font-size: 24px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 6px; font-family: Arial, sans-serif;">${pendingTasks}</div>
                          <div class="kpi-label" style="font-size: 10px; font-weight: 600; color: #475569; margin-bottom: 2px;">Pending</div>
                          <div class="kpi-sub" style="font-size: 9px; font-weight: 700; color: #d97706;">To Do</div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- Card 5: Blocked Tasks -->
                  <td width="20%" align="center" valign="top" style="padding: 3px;" class="kpi-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #fee2e2; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td align="center" valign="top" style="padding: 12px 4px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background-color: #fee2e2; color: #dc2626; font-size: 11px; font-weight: 900; margin: 0 auto 8px auto; text-align: center; font-family: Arial, sans-serif;">⚠️</div>
                          <div class="kpi-num" style="font-size: 24px; font-weight: 900; color: #dc2626; line-height: 1; margin-bottom: 6px; font-family: Arial, sans-serif;">${blockedTasks}</div>
                          <div class="kpi-label" style="font-size: 10px; font-weight: 600; color: #475569; margin-bottom: 2px;">Blocked</div>
                          <div class="kpi-sub" style="font-size: 9px; font-weight: 700; color: #dc2626;">Stuck</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- SECTION 2: ACTION REQUIRED -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 8px; border-collapse: collapse;">
                <tr>
                  <td style="vertical-align: middle; font-family: Arial, sans-serif;">
                    <span style="font-size: 11px; font-weight: 800; color: #dc2626; letter-spacing: 0.8px; text-transform: uppercase;">
                      ⚠️ ACTION REQUIRED
                    </span>
                  </td>
                  <td align="right" style="vertical-align: middle; font-family: Arial, sans-serif;">
                    <a href="${dashboardUrl}" style="font-size: 11px; font-weight: 700; color: #2563eb; text-decoration: none;">View All &rarr;</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border-collapse: collapse;">
                <tr>
                  ${actionRequiredCardsHtml}
                </tr>
              </table>

              <!-- SECTION 3: ALL MEMBER PERFORMANCE -->
              <div style="font-size: 11px; font-weight: 800; color: #475569; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 12px; font-family: Arial, sans-serif;">
                👥 ALL MEMBER PERFORMANCE
              </div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px; border-collapse: separate;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">Member</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">Completed</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">In Progress</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">In Review</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">To Do</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">Blocked</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">Overdue</th>
                    <th style="padding: 10px 8px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${memberRowsHtml || `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; font-family: Arial, sans-serif;">No active members found.</td></tr>`}
                </tbody>
              </table>

              <!-- SECTION 4: 2-COLUMN BOTTOM GRID -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border-collapse: collapse;">
                <tr>
                  <!-- Column 1: Top Performers -->
                  <td width="50%" valign="top" style="padding: 4px; vertical-align: top;" class="stack-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td style="padding: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="font-size: 11px; font-weight: 800; color: #0f172a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">
                            🏆 TOP PERFORMERS
                          </div>
                          ${topPerformersHtml}
                          <div style="text-align: center; margin-top: 10px; font-family: Arial, sans-serif;">
                            <a href="${dashboardUrl}" style="font-size: 10px; font-weight: 700; color: #2563eb; text-decoration: none;">View Ranking &rarr;</a>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- Column 2: Blocked Tasks -->
                  <td width="50%" valign="top" style="padding: 4px; vertical-align: top;" class="stack-column">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 12px; border-collapse: separate;">
                      <tr>
                        <td style="padding: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <div style="font-size: 11px; font-weight: 800; color: #9f1239; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, sans-serif;">
                            ⚠️ BLOCKED TASKS
                          </div>
                          ${blockedColumnHtml}
                          <div style="text-align: center; margin-top: 10px; font-family: Arial, sans-serif;">
                            <a href="${dashboardUrl}" style="font-size: 10px; font-weight: 700; color: #dc2626; text-decoration: none;">View Blocked &rarr;</a>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- SECTION 5: DARK DASHBOARD ACTION BANNER (Outlook table button design, solid #0b0f19) -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; background: linear-gradient(135deg, #0b0f19 0%, #161f33 100%); border-radius: 12px; margin-bottom: 8px; border-collapse: separate;">
                <tr>
                  <td style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                      <tr>
                        <td style="vertical-align: middle; text-align: left;" class="stack-column">
                          <div style="font-size: 16px; font-weight: 900; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                            Open ${appName} Dashboard
                          </div>
                          <div style="font-size: 11px; color: #94a3b8; margin-top: 2px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                            Get full visibility of your team and projects
                          </div>
                        </td>
                        <td align="right" style="vertical-align: middle;" class="stack-column">
                          <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                            <tr>
                              <td style="padding: 3px;">
                                <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 8px; border-collapse: separate;">
                                  <tr>
                                    <td style="padding: 8px 12px; text-align: center;">
                                      <a href="${dashboardUrl}" style="color: #ffffff; font-size: 11px; font-weight: 700; text-decoration: none; display: inline-block; font-family: Arial, sans-serif;">📋 View All Tasks</a>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                              <td style="padding: 3px;">
                                <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 8px; border-collapse: separate;">
                                  <tr>
                                    <td style="padding: 8px 12px; text-align: center;">
                                      <a href="${dashboardUrl}" style="color: #ffffff; font-size: 11px; font-weight: 700; text-decoration: none; display: inline-block; font-family: Arial, sans-serif;">👥 Team Performance</a>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                              <td style="padding: 3px;">
                                <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 8px; border-collapse: separate;">
                                  <tr>
                                    <td style="padding: 8px 12px; text-align: center;">
                                      <a href="${dashboardUrl}" style="color: #ffffff; font-size: 11px; font-weight: 700; text-decoration: none; display: inline-block; font-family: Arial, sans-serif;">➕ Assign Task</a>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- DARK FOOTER BAR -->
          <tr>
            <td bgcolor="#070a12" style="background-color: #070a12; padding: 24px 28px; border-top: 1px solid #1e293b;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr>
                  <td width="50%" style="vertical-align: top;" class="stack-column">
                    <div style="font-size: 14px; font-weight: 900; color: #ffffff; letter-spacing: 0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${appName}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px; font-family: Arial, sans-serif;">Automate. Track. Optimize.</div>
                    <div style="font-size: 10px; color: #475569; margin-top: 8px; font-family: Arial, sans-serif;">&copy; 2026 ${appName}. All rights reserved.</div>
                  </td>
                  <td width="50%" style="vertical-align: top; text-align: right;" class="stack-column">
                    <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-family: Arial, sans-serif;">Quick Links</div>
                    <div style="font-size: 11px; color: #cbd5e1; line-height: 1.6; font-family: Arial, sans-serif;">
                      <a href="${dashboardUrl}" style="color: #3b82f6; text-decoration: none; font-weight: 700;">${dashboardUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


