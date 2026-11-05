/**
 * Audit and Monthly Capacity Report export engine.
 */
import * as XLSX from "xlsx";
import { downloadCSV } from "@/lib/csv";
import {
  getMonthlyCapacityReportFn,
  type CapacityReportRow,
  type ProjectSummaryRow,
} from "./exports.functions";

export interface MonthlyCapacityFilter {
  month?: string;
  from?: string;
  to?: string;
  teamId?: string;
  userId?: string;
  projectId?: string;
}

export type { CapacityReportRow, ProjectSummaryRow };

export function exportMemberCapacityToExcel(
  monthLabel: string,
  rows: CapacityReportRow[],
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  const memberData: (string | number)[][] = [
    [monthLabel],
    [],
    [
      "Team Member",
      "",
      "Project",
      "User Logged Hours",
      "Auto-Tracked Hours",
      "Total Hours (working day in month)",
      "% Project",
    ],
  ];

  rows.forEach((r) => {
    if (r.isSeparatorRow) {
      memberData.push([]);
    } else {
      memberData.push([
        r.teamMember,
        "",
        r.projectName,
        r.hours,
        r.autoHours ?? 0,
        r.totalWorkingHours,
        r.pctProject,
      ]);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(memberData);
  ws["!cols"] = [
    { wch: 22 }, // Team Member
    { wch: 4 },  // Spacing
    { wch: 25 }, // Project
    { wch: 18 }, // User Logged Hours
    { wch: 18 }, // Auto-Tracked Hours
    { wch: 35 }, // Total Hours
    { wch: 15 }, // % Project
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Member Capacity");
  XLSX.writeFile(wb, filename);
}

export function exportProjectSummaryToExcel(
  monthLabel: string,
  projectSummaryRows: ProjectSummaryRow[],
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  const projectData: (string | number)[][] = [
    [monthLabel],
    [],
    ["Project", "Team Hours", "Total Hours in Month", "No of Resources worked on"],
  ];

  projectSummaryRows.forEach((r) => {
    projectData.push([
      r.projectName,
      r.teamHours,
      r.totalWorkingHours,
      r.noOfResources,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(projectData);
  ws["!cols"] = [
    { wch: 28 }, // Project
    { wch: 15 }, // Team Hours
    { wch: 25 }, // Total Hours in Month
    { wch: 30 }, // No of Resources worked on
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Project Summary");
  XLSX.writeFile(wb, filename);
}

export interface ProjectSheetTask {
  id: string;
  task_code: string | null;
  task_name: string;
  status: string;
  planned_hours: number | null;
  actual_hours: number | null;
  logged_hours?: number;
  created_at: string;
  completed_at: string | null;
  assignee_name?: string;
}

export interface ProjectSheetWorklog {
  id: string;
  work_date: string;
  hours: number;
  notes?: string | null;
  task_code?: string | null;
  task_name?: string;
  user_name?: string;
}

export interface ProjectSheetActivity {
  tasks: ProjectSheetTask[];
  worklogs: ProjectSheetWorklog[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One workbook, one sheet per project, mirroring the Project Detail modal
 * (Team Members, Day-wise Breakdown, Tasks & Work Items). Built from the
 * already-loaded report plus per-project activity supplied by the caller.
 */
export function exportProjectsSeparateSheetsToExcel(
  meta: { monthLabel: string; from: string; to: string },
  rows: CapacityReportRow[],
  projectSummaryRows: ProjectSummaryRow[],
  activityByProject: Record<string, ProjectSheetActivity>,
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const sheetName = (name: string) => {
    const base = (name.replace(/[\\/?*[\]:]/g, " ").trim() || "Project").slice(0, 31);
    let candidate = base;
    let n = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const suffix = ` (${n++})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  projectSummaryRows
    .filter((p) => !p.isTotalRow)
    .forEach((p) => {
      const activity = activityByProject[p.projectName] ?? { tasks: [], worklogs: [] };
      const { tasks, worklogs } = activity;
      const memberRows = rows.filter(
        (r) => !r.isTotalRow && !r.isSeparatorRow && r.projectName === p.projectName && r.hours > 0,
      );
      const totalProjectHours = memberRows.reduce((acc, m) => acc + m.hours, 0);

      const data: (string | number)[][] = [
        [`Project Breakdown: ${p.projectName}`],
        [`Period: ${meta.monthLabel}`],
        [],
        ["Total Team Hours", `${round1(totalProjectHours)}h`],
        ["Resource FTE", p.noOfResources],
        ["Active Members", memberRows.length],
        ["Total Tasks", tasks.length],
        [],
        ["TEAM MEMBERS"],
        ["Team Member", "Logged Hours", "Auto Hours", "% of Project", "Workload Share", "Leave in Month"],
      ];

      if (!memberRows.length) {
        data.push(["No member activity logged for this project."]);
      }
      memberRows.forEach((m) => {
        const pct = totalProjectHours > 0 ? Math.round((m.hours / totalProjectHours) * 100) : 0;
        const leave = rows.find(
          (r) => r.teamMember === m.teamMember && r.projectName === "Leave" && r.hours > 0,
        );
        data.push([
          m.teamMember,
          `${m.hours}h`,
          `${m.autoHours ?? 0}h`,
          `${pct}%`,
          `${Math.min(pct, 100)}%`,
          leave ? `${leave.hours}h Leave in Month` : "",
        ]);
      });

      // ---- Day-wise Breakdown ----
      data.push([], ["DAY-WISE BREAKDOWN"]);
      if (worklogs.length > 0) {
        const byDay = new Map<string, ProjectSheetWorklog[]>();
        worklogs.forEach((w) => {
          const key = w.work_date || "Unknown Date";
          byDay.set(key, [...(byDay.get(key) ?? []), w]);
        });
        Array.from(byDay.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .forEach(([dateStr, logs]) => {
            const dayTotal = logs.reduce((acc, l) => acc + (l.hours || 0), 0);
            data.push([`${dateStr} (${logs.length} logged entries)`, "", "", `${round1(dayTotal)}h Logged Today`]);
            data.push(["Member", "Task Code", "Task & Activity", "Hours Logged"]);
            logs.forEach((l) =>
              data.push([
                l.user_name ?? "",
                l.task_code ?? "",
                l.notes ? `${l.task_name ?? ""} — ${l.notes}` : (l.task_name ?? ""),
                `${l.hours}h`,
              ]),
            );
            data.push(["", "", `Total Logged for ${dateStr}:`, `${round1(dayTotal)}h`]);
            data.push([]);
          });
      } else {
        const byDay = new Map<string, ProjectSheetTask[]>();
        tasks.forEach((t) => {
          const key = t.completed_at ? t.completed_at.slice(0, 10) : t.created_at ? t.created_at.slice(0, 10) : "";
          if (!key) return;
          if (meta.from && meta.to && (key < meta.from || key > meta.to)) return;
          byDay.set(key, [...(byDay.get(key) ?? []), t]);
        });
        if (!byDay.size) {
          data.push(["No day-wise worklogs recorded for this project in the selected period."]);
        }
        Array.from(byDay.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .forEach(([dateStr, dayTasks]) => {
            const dayTotal = dayTasks.reduce((acc, t) => acc + (t.logged_hours ?? 0), 0);
            data.push([`${dateStr} (${dayTasks.length} Tasks)`, "", "", "", `${round1(dayTotal)}h Total`]);
            data.push(["Task Code", "Task Title", "Assignee", "Status", "Hours"]);
            dayTasks.forEach((t) =>
              data.push([
                t.task_code || "TSK-—",
                t.task_name,
                t.assignee_name ?? "",
                t.status,
                `${t.logged_hours ?? 0}h`,
              ]),
            );
            data.push(["", "", "", `Total Hours for ${dateStr}:`, `${round1(dayTotal)}h`]);
            data.push([]);
          });
      }

      // ---- Tasks & Work Items ----
      data.push([], ["TASKS & WORK ITEMS"]);
      data.push(["Task Code", "Task Name", "Assignee", "Status", "Logged / Plan"]);
      if (!tasks.length) data.push(["No tasks found for this project."]);
      tasks.forEach((t) =>
        data.push([
          t.task_code || "TSK-—",
          t.task_name,
          t.assignee_name ?? "",
          t.status,
          `${t.logged_hours ?? 0}h${t.planned_hours ? ` / ${t.planned_hours}h` : ""}`,
        ]),
      );

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = [{ wch: 28 }, { wch: 40 }, { wch: 40 }, { wch: 22 }, { wch: 22 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName(p.projectName));
    });

  XLSX.writeFile(wb, filename);
}

export function exportCapacityReportToCSV(
  monthLabel: string,
  rows: CapacityReportRow[],
  filename: string,
) {
  const data: (string | number)[][] = [
    [monthLabel],
    [],
    [
      "Team Member",
      "",
      "Project",
      "User Logged Hours",
      "Auto-Tracked Hours",
      "Total Hours (working day in month)",
      "% Project",
    ],
  ];

  rows.forEach((r) => {
    if (r.isSeparatorRow) {
      data.push([]);
    } else {
      data.push([
        r.teamMember,
        "",
        r.projectName,
        r.hours,
        r.autoHours ?? 0,
        r.totalWorkingHours,
        r.pctProject,
      ]);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const csvContent = XLSX.utils.sheet_to_csv(ws);
  downloadCSV(filename, csvContent);
}

export function exportProjectSummaryToCSV(
  monthLabel: string,
  rows: ProjectSummaryRow[],
  filename: string,
) {
  const data: (string | number)[][] = [
    [monthLabel],
    [],
    ["Project", "Team Hours", "Total Hours in Month", "No of Resources worked on"],
  ];

  rows.forEach((r) => {
    data.push([
      r.projectName,
      r.teamHours,
      r.totalWorkingHours,
      r.noOfResources,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const csvContent = XLSX.utils.sheet_to_csv(ws);
  downloadCSV(filename, csvContent);
}

export interface LeaveCalendarRow {
  leave_type: string;
  start_date: string;
  end_date: string;
  days_count?: number;
  status: string;
  reason?: string;
  request_to_name?: string | null;
  reviewer_name?: string | null;
}

const LEAVE_CODES: Record<string, { code: string; label: string }> = {
  planned: { code: "PL", label: "Planned Leave" },
  tentative: { code: "TL", label: "Tentative Leave" },
  sick: { code: "SL", label: "Sick Leave" },
  wfh: { code: "WFH", label: "Work From Home" },
  half_day: { code: "HD", label: "Half Day" },
  paid: { code: "PD", label: "Paid Leave" },
  unpaid: { code: "UL", label: "Unpaid Leave" },
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Full-year leave calendar workbook: a month x day grid (codes per day),
 * the list of leave records and a per-type summary. Rejected and cancelled leaves are left out.
 */
export function exportLeaveCalendarToExcel(year: number, leaves: LeaveCalendarRow[], userName: string, filename: string) {
  const typeOf = (l: LeaveCalendarRow) => (l.leave_type === "casual" ? "planned" : l.leave_type);
  const active = leaves
    .filter((l) => l.status !== "rejected" && l.status !== "cancelled")
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  // "YYYY-MM-DD" -> codes on that day; pending leaves get a "*" suffix, tentative a "?"
  const byDay = new Map<string, string[]>();
  for (const l of active) {
    const meta = LEAVE_CODES[typeOf(l)] ?? { code: typeOf(l).toUpperCase(), label: typeOf(l) };
    const code = l.status === "pending" ? `${meta.code}*` : l.status === "tentative" ? `${meta.code}?` : meta.code;
    const [sy, sm, sd] = l.start_date.slice(0, 10).split("-").map(Number);
    const [ey, em, ed] = (l.end_date || l.start_date).slice(0, 10).split("-").map(Number);
    const end = Date.UTC(ey, em - 1, ed);
    for (let t = Date.UTC(sy, sm - 1, sd); t <= end; t += 86_400_000) {
      const d = new Date(t);
      if (d.getUTCFullYear() !== year) continue;
      const dow = d.getUTCDay();
      if ((dow === 0 || dow === 6) && l.start_date !== l.end_date) continue; // ranges skip weekends
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), code]);
    }
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: calendar grid
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const grid: (string | number)[][] = [
    [`Leave Calendar ${year} - ${userName}`],
    [
      "Legend: " +
        Object.values(LEAVE_CODES)
          .map((c) => `${c.code} = ${c.label}`)
          .join(", ") +
        ", * = pending approval, ? = tentative, Sa/Su = weekend",
    ],
    [],
    ["Month", ...days, "Leave Days", "WFH Days"],
  ];
  for (let m = 0; m < 12; m++) {
    const inMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    let leaveDays = 0;
    let wfhDays = 0;
    const cells = days.map((day) => {
      if (day > inMonth) return "";
      const key = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const codes = byDay.get(key);
      if (codes) {
        for (const c of codes) {
          if (c.endsWith("*") || c.endsWith("?") || c.startsWith("TL")) continue; // count only approved leave
          if (c === "WFH") wfhDays += 1;
          else leaveDays += c === "HD" ? 0.5 : 1;
        }
        return codes.join("/");
      }
      const dow = new Date(Date.UTC(year, m, day)).getUTCDay();
      return dow === 0 ? "Su" : dow === 6 ? "Sa" : "";
    });
    grid.push([MONTHS[m], ...cells, leaveDays, wfhDays]);
  }
  const calWs = XLSX.utils.aoa_to_sheet(grid);
  calWs["!cols"] = [{ wch: 12 }, ...days.map(() => ({ wch: 5 })), { wch: 11 }, { wch: 10 }];
  calWs["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 33 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 33 } },
  ];
  XLSX.utils.book_append_sheet(wb, calWs, "Calendar");

  // Sheet 2: leave records
  const list: (string | number)[][] = [["Type", "From", "To", "Days", "Status", "Reason", "Requested To", "Reviewed By"]];
  for (const l of active) {
    list.push([
      LEAVE_CODES[typeOf(l)]?.label ?? l.leave_type,
      l.start_date.slice(0, 10),
      (l.end_date || l.start_date).slice(0, 10),
      Number(l.days_count ?? 1),
      l.status,
      l.reason ?? "",
      l.request_to_name ?? "",
      l.reviewer_name ?? "",
    ]);
  }
  const listWs = XLSX.utils.aoa_to_sheet(list);
  listWs["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 11 }, { wch: 40 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, listWs, "Leave List");

  // Sheet 3: per-type, per-month approved days
  const types = Object.keys(LEAVE_CODES).filter((t) => active.some((l) => typeOf(l) === t));
  const summary: (string | number)[][] = [["Leave Type", ...MONTHS.map((m) => m.slice(0, 3)), "Approved", "Pending", "Tentative"]];
  for (const t of types) {
    const rows = active.filter((l) => typeOf(l) === t);
    const sum = (ls: LeaveCalendarRow[]) => ls.reduce((a, l) => a + Number(l.days_count ?? 1), 0);
    const approved = rows.filter((l) => l.status === "approved");
    summary.push([
      LEAVE_CODES[t].label,
      ...MONTHS.map((_, i) => sum(approved.filter((l) => Number(l.start_date.slice(5, 7)) === i + 1))),
      sum(approved),
      sum(rows.filter((l) => l.status === "pending")),
      sum(rows.filter((l) => l.status === "tentative")),
    ]);
  }
  const sumWs = XLSX.utils.aoa_to_sheet(summary);
  sumWs["!cols"] = [{ wch: 18 }, ...MONTHS.map(() => ({ wch: 6 })), { wch: 10 }, { wch: 9 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, sumWs, "Summary");

  XLSX.writeFile(wb, filename);
}

export const exportsService = {
  async getMonthlyCapacityReport(filters: MonthlyCapacityFilter) {
    return await getMonthlyCapacityReportFn({ data: filters });
  },
};
