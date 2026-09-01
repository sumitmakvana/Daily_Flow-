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



