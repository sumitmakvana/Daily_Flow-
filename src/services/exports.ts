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
            const dayTotal = dayTasks.reduce((acc, t) => acc + (t.actual_hours ?? t.planned_hours ?? 0), 0);
            data.push([`${dateStr} (${dayTasks.length} Tasks)`, "", "", "", `${round1(dayTotal)}h Total`]);
            data.push(["Task Code", "Task Title", "Assignee", "Status", "Hours"]);
            dayTasks.forEach((t) =>
              data.push([
                t.task_code || "TSK-—",
                t.task_name,
                t.assignee_name ?? "",
                t.status,
                `${t.actual_hours ?? t.planned_hours ?? 0}h`,
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
          `${t.actual_hours ?? t.planned_hours ?? 0}h${t.planned_hours ? ` / ${t.planned_hours}h` : ""}`,
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

export const exportsService = {
  async getMonthlyCapacityReport(filters: MonthlyCapacityFilter) {
    return await getMonthlyCapacityReportFn({ data: filters });
  },
};
