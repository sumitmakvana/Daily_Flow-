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
  blockedAlerts: Array<{ code: string; name: string; memberName: string; reason: string }>;
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
  } = data;

  const memberRowsHtml = memberSummaries
    .map((m, idx) => {
      const initials =
        m.name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "TM";
      const bgColor = idx % 2 === 0 ? "#ffffff" : "#f8fafc";

      return `
      <tr style="background-color: ${bgColor}; border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 8px; font-weight: 600; color: #0f172a; font-size: 13px; word-break: break-word;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="width: 100%;">
            <tr>
              <td style="width: 26px; vertical-align: middle;">
                <div style="width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background: #e0e7ff; color: #3730a3; text-align: center; font-size: 10px; font-weight: 700;">${initials}</div>
              </td>
              <td style="padding-left: 6px; vertical-align: middle; color: #0f172a; font-weight: 600; font-size: 12px; line-height: 1.3;">
                ${escapeHtml(m.name)}
              </td>
            </tr>
          </table>
        </td>
        <td style="padding: 8px 4px; text-align: center; vertical-align: middle;">
          <span style="display: inline-block; background: ${m.completedCount > 0 ? "#dcfce7" : "#f1f5f9"}; color: ${m.completedCount > 0 ? "#15803d" : "#94a3b8"}; padding: 2px 7px; border-radius: 10px; font-weight: 700; font-size: 11px;">${m.completedCount}</span>
        </td>
        <td style="padding: 8px 4px; text-align: center; vertical-align: middle;">
          <span style="display: inline-block; background: ${m.inProgressCount > 0 ? "#dbeafe" : "#f1f5f9"}; color: ${m.inProgressCount > 0 ? "#1d4ed8" : "#94a3b8"}; padding: 2px 7px; border-radius: 10px; font-weight: 700; font-size: 11px;">${m.inProgressCount}</span>
        </td>
        <td style="padding: 8px 4px; text-align: center; vertical-align: middle;">
          <span style="display: inline-block; background: ${m.blockedCount > 0 ? "#fee2e2" : "#f1f5f9"}; color: ${m.blockedCount > 0 ? "#b91c1c" : "#94a3b8"}; padding: 2px 7px; border-radius: 10px; font-weight: 700; font-size: 11px;">${m.blockedCount}</span>
        </td>
        <td style="padding: 8px 4px; text-align: center; vertical-align: middle;">
          <span style="display: inline-block; background: ${m.pendingCount > 0 ? "#fef3c7" : "#f1f5f9"}; color: ${m.pendingCount > 0 ? "#b45309" : "#94a3b8"}; padding: 2px 7px; border-radius: 10px; font-weight: 700; font-size: 11px;">${m.pendingCount}</span>
        </td>
      </tr>
      `;
    })
    .join("");

  const blockedAlertsHtml = blockedAlerts.length
    ? blockedAlerts
        .map(
          (b) => `
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fff1f2; border: 1px solid #fecdd3; border-left: 4px solid #e11d48; margin-bottom: 8px; border-radius: 6px;">
            <tr>
              <td style="padding: 10px 12px;">
                <div style="font-weight: 700; color: #881337; font-size: 12px; line-height: 1.4; word-break: break-word;">
                  <span style="background: #ffe4e6; color: #9f1239; padding: 1px 5px; border-radius: 4px; font-family: monospace; font-size: 10px; margin-right: 4px;">${escapeHtml(b.code)}</span>
                  <span>${escapeHtml(b.name)}</span>
                  <span style="display: inline-block; font-size: 10px; color: #475569; font-weight: 600; background: #ffffff; padding: 1px 6px; border-radius: 4px; border: 1px solid #cbd5e1; margin-left: 4px;">👤 ${escapeHtml(b.memberName)}</span>
                </div>
                <div style="color: #be123c; font-size: 11px; margin-top: 5px; background: #ffffff; padding: 6px 8px; border-radius: 4px; border: 1px solid #fecdd3; word-break: break-word;">
                  ⚠️ <strong>Blocker Reason:</strong> ${escapeHtml(b.reason || "No blocker details provided")}
                </div>
              </td>
            </tr>
          </table>
        `,
        )
        .join("")
    : `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; padding: 12px; border-radius: 6px; font-size: 12px; text-align: center; font-weight: 600;">🎉 Great Job! No blocked tasks reported today.</div>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Encoding" content="gzip">
  <title>Daily Flow - EOD Executive Team Digest (${dateStr})</title>
  <style type="text/css">
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    @media screen and (max-width: 600px) {
      .mobile-padding { padding: 12px !important; }
      .mobile-title { font-size: 16px !important; }
      .mobile-rate-val { font-size: 22px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 12px; background-color: #f1f5f9;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 650px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: #0f172a; padding: 20px 24px; border-bottom: 3px solid #6366f1;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <div class="mobile-title" style="font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px; line-height: 1.2;">⚡ DAILY FLOW EXECUTIVE DIGEST</div>
                    <div style="font-size: 11px; color: #94a3b8; margin-top: 3px;">Team Performance & EOD Report · <strong>${dateStr}</strong></div>
                  </td>
                  <td align="right" style="vertical-align: middle; width: 90px;">
                    <div style="background: rgba(255,255,255,0.1); padding: 6px 10px; border-radius: 8px; text-align: center; border: 1px solid rgba(255,255,255,0.15);">
                      <div class="mobile-rate-val" style="font-size: 22px; font-weight: 900; color: #34d399; line-height: 1;">${completionRate}%</div>
                      <div style="font-size: 8px; color: #cbd5e1; font-weight: 700; text-transform: uppercase; margin-top: 2px;">COMPLETION</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td class="mobile-padding" style="padding: 20px 24px;">
              
              <!-- 2x2 Mobile Responsive KPI Grid -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="50%" style="padding: 4px;">
                    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px 8px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 14px;">✅</div>
                      <div style="font-size: 20px; font-weight: 800; color: #15803d; margin-top: 2px;">${completedTasks}</div>
                      <div style="font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; margin-top: 2px;">COMPLETED TODAY</div>
                    </div>
                  </td>
                  <td width="50%" style="padding: 4px;">
                    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 8px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 14px;">⏳</div>
                      <div style="font-size: 20px; font-weight: 800; color: #1d4ed8; margin-top: 2px;">${inProgressTasks}</div>
                      <div style="font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; margin-top: 2px;">IN PROGRESS</div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding: 4px;">
                    <div style="background-color: #fff1f2; border: 1px solid #fecdd3; padding: 10px 8px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 14px;">🚨</div>
                      <div style="font-size: 20px; font-weight: 800; color: #b91c1c; margin-top: 2px;">${blockedTasks}</div>
                      <div style="font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; margin-top: 2px;">BLOCKED</div>
                    </div>
                  </td>
                  <td width="50%" style="padding: 4px;">
                    <div style="background-color: #fffbeb; border: 1px solid #fde68a; padding: 10px 8px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 14px;">📌</div>
                      <div style="font-size: 20px; font-weight: 800; color: #b45309; margin-top: 2px;">${pendingTasks}</div>
                      <div style="font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; margin-top: 2px;">PENDING QUEUE</div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Member Breakdown Summary Section -->
              <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-top: 16px; margin-bottom: 10px; border-left: 3px solid #4f46e5; padding-left: 8px;">
                📊 Member-wise Performance Summary
              </div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 8px 6px; text-align: left; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase;">Member</th>
                    <th style="padding: 8px 4px; text-align: center; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase;">Done</th>
                    <th style="padding: 8px 4px; text-align: center; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase;">Active</th>
                    <th style="padding: 8px 4px; text-align: center; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase;">Stuck</th>
                    <th style="padding: 8px 4px; text-align: center; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase;">ToDo</th>
                  </tr>
                </thead>
                <tbody>
                  ${memberRowsHtml || `<tr><td colspan="5" style="text-align: center; padding: 15px; color: #94a3b8; font-size: 12px;">No task activity today.</td></tr>`}
                </tbody>
              </table>

              <!-- Blocked Alerts Section -->
              <div style="font-size: 13px; font-weight: 700; color: #b91c1c; margin-top: 16px; margin-bottom: 8px; border-left: 3px solid #e11d48; padding-left: 8px;">
                🚨 Blocked Tasks Requiring Manager Attention (${blockedAlerts.length})
              </div>
              ${blockedAlertsHtml}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 14px 20px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              Daily Flow Executive Engine · Automated EOD Summary @ 06:00 PM IST
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
