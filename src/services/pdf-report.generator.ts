export interface EodReportData {
  dateStr: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  pendingTasks: number;
  completionRate: number;
  memberSummaries: Array<{
    name: string;
    completedCount: number;
    inProgressCount: number;
    blockedCount: number;
    pendingCount: number;
    tasks?: Array<{ code: string; name: string; status: string; remarks?: string | null }>;
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
    blockedTasks,
    pendingTasks,
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
    const totalMemberTasks =
      m.completedCount + m.inProgressCount + m.blockedCount + m.pendingCount;
    const progress =
      totalMemberTasks > 0 ? Math.round((m.completedCount / totalMemberTasks) * 100) : 0;
    const initials =
      m.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "TM";
    return { ...m, totalMemberTasks, progress, initials };
  });

  // Top Performers (sorted by progress desc then completedCount desc)
  const topPerformers = [...enrichedMembers]
    .sort((a, b) => b.progress - a.progress || b.completedCount - a.completedCount)
    .slice(0, 3);

  // Fallback upcoming deadlines if not passed
  const defaultUpcomingDeadlines = [
    { dateLabel: "Today", name: "Beat Planner Release", priority: "High Priority" },
    { dateLabel: "Tomorrow", name: "Geo Dashboard QA", priority: "Medium Priority" },
    { dateLabel: "12 Aug", name: "Micro Market Deployment", priority: "Medium Priority" },
  ];
  const upcomingDeadlines =
    passedDeadlines && passedDeadlines.length > 0 ? passedDeadlines : defaultUpcomingDeadlines;

  // Format Member rows HTML for the table
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
        <td style="padding: 10px 12px; font-weight: 600; color: #0f172a; font-size: 13px; vertical-align: middle;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="width: 100%;">
            <tr>
              <td style="width: 28px; vertical-align: middle;">
                <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: ${colorScheme.bg}; color: ${colorScheme.text}; text-align: center; font-size: 11px; font-weight: 700;">${m.initials}</div>
              </td>
              <td style="padding-left: 8px; vertical-align: middle; color: #1e293b; font-weight: 600; font-size: 13px;">
                ${escapeHtml(m.name)}
              </td>
            </tr>
          </table>
        </td>
        <td style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #2563eb; font-size: 13px;">
          ${m.inProgressCount}
        </td>
        <td style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #16a34a; font-size: 13px;">
          ${m.completedCount}
        </td>
        <td style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #d97706; font-size: 13px;">
          ${m.pendingCount}
        </td>
        <td style="padding: 10px 6px; text-align: center; vertical-align: middle; font-weight: 700; color: #dc2626; font-size: 13px;">
          ${m.blockedCount}
        </td>
        <td style="padding: 10px 12px; text-align: right; vertical-align: middle; width: 120px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="width: 100%;">
            <tr>
              <td style="font-size: 11px; font-weight: 700; color: #334155; text-align: right; padding-right: 6px; width: 35px;">${m.progress}%</td>
              <td style="vertical-align: middle;">
                <div style="background-color: #e2e8f0; border-radius: 6px; height: 7px; width: 100%; overflow: hidden;">
                  <div style="background-color: ${m.progress > 50 ? "#16a34a" : m.progress > 20 ? "#2563eb" : "#cbd5e1"}; height: 7px; border-radius: 6px; width: ${m.progress}%;"></div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      `;
    })
    .join("");

  // Action Required Cards HTML
  const actionRequiredCardsHtml = blockedAlerts.length
    ? blockedAlerts
        .slice(0, 3)
        .map(
          (b, idx) => `
          <td width="32%" style="padding: 4px; vertical-align: top;" class="action-card-column">
            <div style="background-color: #ffffff; border: 1px solid #fee2e2; border-radius: 10px; padding: 12px; height: 100%; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
              <div style="margin-bottom: 6px;">
                <span style="background-color: ${idx === 0 ? "#fee2e2" : "#ffedd5"}; color: ${idx === 0 ? "#b91c1c" : "#c2410c"}; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${idx === 0 ? "HIGH" : "MEDIUM"}</span>
              </div>
              <div style="font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.3; margin-bottom: 8px; max-height: 34px; overflow: hidden;">
                ${escapeHtml(b.name)}
              </div>
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 6px;">
                <tr>
                  <td style="width: 16px; vertical-align: middle;">
                    <div style="width: 14px; height: 14px; line-height: 14px; background: #e2e8f0; color: #475569; text-align: center; border-radius: 50%; font-size: 8px; font-weight: 700;">👤</div>
                  </td>
                  <td style="padding-left: 4px; vertical-align: middle; font-size: 10px; color: #64748b;">
                    Assigned to <strong style="color: #334155;">${escapeHtml(b.memberName)}</strong>
                  </td>
                </tr>
              </table>
              <div style="font-size: 10px; font-weight: 700; color: #dc2626; margin-top: 6px; background-color: #fff1f2; padding: 4px 6px; border-radius: 4px; border: 1px solid #fecdd3;">
                ${escapeHtml(b.duration || b.reason || "Blocked Since 2 Days")}
              </div>
            </div>
          </td>
        `,
        )
        .join("") +
      (blockedAlerts.length > 3
        ? `
        <td width="32%" style="padding: 4px; vertical-align: top;" class="action-card-column">
          <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 18px 10px; text-align: center; box-sizing: border-box;">
            <div style="font-size: 24px; font-weight: 900; color: #2563eb; line-height: 1; margin-bottom: 4px;">+${blockedAlerts.length - 3}</div>
            <div style="font-size: 11px; font-weight: 700; color: #475569; line-height: 1.3; margin-bottom: 8px;">More Issues</div>
            <div>
              <a href="${dashboardUrl}" style="font-size: 11px; font-weight: 700; color: #2563eb; text-decoration: none; white-space: nowrap; display: inline-block;">View All &rarr;</a>
            </div>
          </div>
        </td>
      `
        : "")
    : `
      <td width="100%" style="padding: 4px;">
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 14px; border-radius: 8px; font-size: 12px; text-align: center; font-weight: 600;">
          🎉 Excellent! No active blocker issues requiring immediate action today.
        </div>
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
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td style="width: 22px; vertical-align: middle;">
                  <div style="width: 18px; height: 18px; line-height: 18px; border-radius: 50%; background-color: ${medalBg}; color: ${medalText}; text-align: center; font-size: 10px; font-weight: 800;">${medal}</div>
                </td>
                <td style="vertical-align: middle; font-size: 12px; font-weight: 700; color: #1e293b; padding-left: 6px;">
                  ${escapeHtml(tp.name)}
                </td>
                <td style="text-align: right; vertical-align: middle; width: 55px;">
                  <span style="font-size: 12px; font-weight: 800; color: #16a34a;">${tp.progress}%</span>
                </td>
              </tr>
            </table>
          </div>
        `;
        })
        .join("")
    : `<div style="font-size: 11px; color: #94a3b8; text-align: center; padding: 10px;">No performance data recorded</div>`;

  // Blocked Tasks Column HTML
  const blockedColumnHtml = blockedAlerts.length
    ? blockedAlerts
        .slice(0, 3)
        .map(
          (b) => `
          <div style="margin-bottom: 10px; background-color: #ffffff; border: 1px solid #fee2e2; padding: 8px 10px; border-radius: 8px;">
            <div style="font-size: 11px; font-weight: 700; color: #0f172a;">
              🔹 ${escapeHtml(b.name)}
            </div>
            <div style="font-size: 10px; color: #64748b; margin-top: 3px;">
              Assigned to: <span style="color: #334155;">${escapeHtml(b.memberName)}</span>
            </div>
            <div style="font-size: 10px; font-weight: 700; color: #dc2626; margin-top: 2px;">
              Blocked Since: ${escapeHtml(b.duration || "2 Days")}
            </div>
          </div>
        `,
        )
        .join("")
    : `<div style="font-size: 11px; color: #16a34a; background: #f0fdf4; padding: 8px; border-radius: 6px; text-align: center;">No blocked tasks!</div>`;

  // Upcoming Deadlines Column HTML
  const deadlinesHtml = upcomingDeadlines
    .slice(0, 3)
    .map((d, idx) => {
      const labelColor = idx === 0 ? "#dc2626" : idx === 1 ? "#d97706" : "#2563eb";
      return `
      <div style="margin-bottom: 10px; background-color: #ffffff; border: 1px solid #f1f5f9; padding: 8px 10px; border-radius: 8px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width: 65px; vertical-align: middle;">
              <span style="font-size: 10px; font-weight: 800; color: ${labelColor}; display: inline-block;">${escapeHtml(d.dateLabel)}</span>
            </td>
            <td style="vertical-align: middle;">
              <div style="font-size: 11px; font-weight: 700; color: #1e293b;">${escapeHtml(d.name)}</div>
              <div style="font-size: 9px; color: #94a3b8;">${escapeHtml(d.priority)}</div>
            </td>
            <td style="text-align: right; vertical-align: middle; width: 15px; color: #cbd5e1; font-weight: 700; font-size: 12px;">
              &rsaquo;
            </td>
          </tr>
        </table>
      </div>
    `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Encoding" content="gzip">
  <title>${appName} - Executive Daily Digest (${dateStr})</title>
  <style type="text/css">
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    
    @media screen and (max-width: 640px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .mobile-padding { padding: 12px 14px !important; }
      .stack-column, .action-card-column { display: block !important; width: 100% !important; max-width: 100% !important; padding: 4px 0 !important; box-sizing: border-box !important; }
      .kpi-column { display: inline-block !important; width: 48% !important; max-width: 48% !important; vertical-align: top !important; padding: 3px !important; box-sizing: border-box !important; }
      .mobile-title { font-size: 18px !important; }
      .mobile-hide { display: none !important; }
      .kpi-box { padding: 10px 4px !important; }
      .kpi-num { font-size: 22px !important; }
      .kpi-label { font-size: 10px !important; }
      .kpi-sub { font-size: 9px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 16px 0; background-color: #f1f5f9;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
    <tr>
      <td align="center">
        <!-- Main Email Container Card -->
        <table role="presentation" width="100%" class="container" border="0" cellspacing="0" cellpadding="0" style="max-width: 680px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
          
          <!-- DARK EXECUTIVE HEADER CARD -->
          <tr>
            <td style="background: linear-gradient(135deg, #0b0f19 0%, #161f33 100%); padding: 24px 28px; border-bottom: 3px solid #3b82f6;">
              <!-- Header Top Bar -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 12px;">
                <tr>
                  <td style="vertical-align: middle;">
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="vertical-align: middle;">
                          <div style="width: 16px; height: 16px; border-radius: 50%; border: 3px solid #3b82f6; background-color: #6366f1;"></div>
                        </td>
                        <td style="padding-left: 8px; vertical-align: middle; font-size: 16px; font-weight: 900; color: #ffffff; letter-spacing: 1px;">
                          ${appName}
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <div style="font-size: 10px; color: #cbd5e1; font-weight: 600; text-align: right;">
                      📅 Automated Daily Report
                    </div>
                    <div style="font-size: 10px; color: #94a3b8; font-weight: 700; text-align: right; margin-top: 2px;">
                      ${dateStr}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Main Header Digest Title & Team Health Score Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <div class="mobile-title" style="font-size: 24px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px; line-height: 1.2;">
                      Daily Executive Digest
                    </div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px; font-weight: 500;">
                      Team Performance & Action Report
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle; width: 160px;">
                    <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 12px; padding: 12px 16px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                      <div style="font-size: 9px; color: #94a3b8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px;">TEAM HEALTH SCORE</div>
                      <div style="font-size: 30px; font-weight: 900; color: #22c55e; line-height: 1; letter-spacing: -0.5px; margin: 2px 0;">${healthScore}%</div>
                      <div style="font-size: 10px; color: #22c55e; font-weight: 700;">▲ ${healthDelta.replace(/^▲\s*/, "")}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MAIN BODY CONTAINER -->
          <tr>
            <td class="mobile-padding" style="padding: 24px 28px;">

              <!-- SECTION 1: OVERVIEW KPI CARDS -->
              <div style="font-size: 11px; font-weight: 800; color: #334155; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 12px;">
                📊 OVERVIEW
              </div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; table-layout: fixed;">
                <tr>
                  <!-- Card 1: Total Tasks -->
                  <td width="20%" style="padding: 3px; vertical-align: top;" class="kpi-column">
                    <div class="kpi-box" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 8px; text-align: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                      <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: #dcfce7; color: #16a34a; font-size: 12px; font-weight: 900; margin: 0 auto 10px auto;">✓</div>
                      <div class="kpi-num" style="font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 8px;">${totalTasks}</div>
                      <div class="kpi-label" style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">Total Tasks</div>
                      <div class="kpi-sub" style="font-size: 10px; font-weight: 700; color: #16a34a;">Today's Workload</div>
                    </div>
                  </td>

                  <!-- Card 2: Active Tasks -->
                  <td width="20%" style="padding: 3px; vertical-align: top;" class="kpi-column">
                    <div class="kpi-box" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 8px; text-align: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                      <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: #dbeafe; color: #2563eb; font-size: 11px; font-weight: 900; margin: 0 auto 10px auto;">▶</div>
                      <div class="kpi-num" style="font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 8px;">${inProgressTasks}</div>
                      <div class="kpi-label" style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">Active Tasks</div>
                      <div class="kpi-sub" style="font-size: 10px; font-weight: 700; color: #2563eb;">In Progress</div>
                    </div>
                  </td>

                  <!-- Card 3: Completed Tasks -->
                  <td width="20%" style="padding: 3px; vertical-align: top;" class="kpi-column">
                    <div class="kpi-box" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 8px; text-align: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                      <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: #f3e8ff; color: #7c3aed; font-size: 12px; font-weight: 900; margin: 0 auto 10px auto;">📋</div>
                      <div class="kpi-num" style="font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 8px;">${completedTasks}</div>
                      <div class="kpi-label" style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">Completed Tasks</div>
                      <div class="kpi-sub" style="font-size: 10px; font-weight: 700; color: #16a34a;">Completed Today</div>
                    </div>
                  </td>

                  <!-- Card 4: Pending Tasks -->
                  <td width="20%" style="padding: 3px; vertical-align: top;" class="kpi-column">
                    <div class="kpi-box" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 8px; text-align: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                      <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: #fef3c7; color: #d97706; font-size: 12px; font-weight: 900; margin: 0 auto 10px auto;">⏱</div>
                      <div class="kpi-num" style="font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1; margin-bottom: 8px;">${pendingTasks}</div>
                      <div class="kpi-label" style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">Pending Tasks</div>
                      <div class="kpi-sub" style="font-size: 10px; font-weight: 700; color: #d97706;">Pending To Do</div>
                    </div>
                  </td>

                  <!-- Card 5: Blocked Tasks -->
                  <td width="20%" style="padding: 3px; vertical-align: top;" class="kpi-column">
                    <div class="kpi-box" style="background-color: #ffffff; border: 1px solid #fee2e2; border-radius: 12px; padding: 14px 8px; text-align: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                      <div style="width: 26px; height: 26px; line-height: 26px; border-radius: 50%; background-color: #fee2e2; color: #dc2626; font-size: 12px; font-weight: 900; margin: 0 auto 10px auto;">⚠️</div>
                      <div class="kpi-num" style="font-size: 26px; font-weight: 900; color: #dc2626; line-height: 1; margin-bottom: 8px;">${blockedTasks}</div>
                      <div class="kpi-label" style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 3px;">Blocked Tasks</div>
                      <div class="kpi-sub" style="font-size: 10px; font-weight: 700; color: #dc2626;">Blocked / Stuck</div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- SECTION 2: ACTION REQUIRED -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 8px;">
                <tr>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 11px; font-weight: 800; color: #dc2626; letter-spacing: 0.8px; text-transform: uppercase;">
                      ⚠️ ACTION REQUIRED
                    </span>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <a href="${dashboardUrl}" style="font-size: 11px; font-weight: 700; color: #2563eb; text-decoration: none;">View All &rarr;</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  ${actionRequiredCardsHtml}
                </tr>
              </table>

              <!-- SECTION 3: ALL MEMBER PERFORMANCE -->
              <div style="font-size: 11px; font-weight: 800; color: #475569; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 12px;">
                👥 ALL MEMBER PERFORMANCE
              </div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Member</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Active</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Completed</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Pending</th>
                    <th style="padding: 10px 6px; text-align: center; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Blocked</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  ${memberRowsHtml || `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">No active members found.</td></tr>`}
                </tbody>
              </table>

              <!-- SECTION 4: 3-COLUMN BOTTOM GRID -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <!-- Column 1: Top Performers -->
                  <td width="33.33%" style="padding: 4px; vertical-align: top;" class="stack-column">
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; height: 100%; box-sizing: border-box;">
                      <div style="font-size: 11px; font-weight: 800; color: #0f172a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                        🏆 TOP PERFORMERS
                      </div>
                      ${topPerformersHtml}
                      <div style="text-align: center; margin-top: 10px;">
                        <a href="${dashboardUrl}" style="font-size: 10px; font-weight: 700; color: #2563eb; text-decoration: none;">View Full Ranking &rarr;</a>
                      </div>
                    </div>
                  </td>

                  <!-- Column 2: Blocked Tasks -->
                  <td width="33.33%" style="padding: 4px; vertical-align: top;" class="stack-column">
                    <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 12px; padding: 14px; height: 100%; box-sizing: border-box;">
                      <div style="font-size: 11px; font-weight: 800; color: #9f1239; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                        ⚠️ BLOCKED TASKS
                      </div>
                      ${blockedColumnHtml}
                      <div style="text-align: center; margin-top: 10px;">
                        <a href="${dashboardUrl}" style="font-size: 10px; font-weight: 700; color: #dc2626; text-decoration: none;">View All Blocked Tasks &rarr;</a>
                      </div>
                    </div>
                  </td>

                  <!-- Column 3: Upcoming Deadlines -->
                  <td width="33.33%" style="padding: 4px; vertical-align: top;" class="stack-column">
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; height: 100%; box-sizing: border-box;">
                      <div style="font-size: 11px; font-weight: 800; color: #0f172a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                        📅 UPCOMING DEADLINES
                      </div>
                      ${deadlinesHtml}
                      <div style="text-align: center; margin-top: 10px;">
                        <a href="${dashboardUrl}" style="font-size: 10px; font-weight: 700; color: #2563eb; text-decoration: none;">View Full Calendar &rarr;</a>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- SECTION 5: DARK DASHBOARD ACTION BANNER -->
              <div style="background: linear-gradient(135deg, #0b0f19 0%, #161f33 100%); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 8px;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align: middle; text-align: left;" class="stack-column">
                      <div style="font-size: 16px; font-weight: 900; color: #ffffff;">
                        Open ${appName} Dashboard
                      </div>
                      <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                        Get full visibility of your team and projects
                      </div>
                    </td>
                    <td align="right" style="vertical-align: middle;" class="stack-column">
                      <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="padding: 2px;">
                            <a href="${dashboardUrl}" style="display: inline-block; background-color: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #ffffff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none;">📋 View All Tasks</a>
                          </td>
                          <td style="padding: 2px;">
                            <a href="${dashboardUrl}" style="display: inline-block; background-color: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #ffffff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none;">👥 View Team Performance</a>
                          </td>
                          <td style="padding: 2px;">
                            <a href="${dashboardUrl}" style="display: inline-block; background-color: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #ffffff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none;">➕ Create / Assign Task</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>

            </td>
          </tr>

          <!-- DARK FOOTER BAR -->
          <tr>
            <td style="background-color: #070a12; padding: 24px 28px; border-top: 1px solid #1e293b;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" style="vertical-align: top;" class="stack-column">
                    <div style="font-size: 14px; font-weight: 900; color: #ffffff; letter-spacing: 0.5px;">${appName}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Automate. Track. Optimize.</div>
                    <div style="font-size: 10px; color: #475569; margin-top: 8px;">&copy; 2026 ${appName}. All rights reserved.</div>
                  </td>
                  <td width="50%" style="vertical-align: top; text-align: right;" class="stack-column">
                    <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Quick Links</div>
                    <div style="font-size: 11px; color: #cbd5e1; line-height: 1.6;">
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

