/**
 * Audit export engine. CSV-first (no extra deps). XLSX is delivered as
 * CSV with `.xls`-compatible content-type fallback so users can open in Excel.
 */
import { toCSV, downloadCSV } from "@/lib/csv";
import { todayISO } from "@/lib/format";
import { buildExportRowsFn, recordExportFn } from "./exports.functions";

export type ExportKind =
  | "task_audit"
  | "user_activity"
  | "carry_forward"
  | "blockers"
  | "workload"
  | "sla_violations"
  | "daily_ops";

export type ExportFormat = "csv" | "xls";

export interface ExportFilters {
  from?: string;
  to?: string;
  teamId?: string;
  projectId?: string;
  userId?: string;
  status?: string;
}

export const EXPORT_LABELS: Record<ExportKind, string> = {
  task_audit: "Task audit trail",
  user_activity: "User activity report",
  carry_forward: "Carry-forward history",
  blockers: "Blocker report",
  workload: "Workload summary",
  sla_violations: "SLA violations",
  daily_ops: "Daily operations summary",
};

export const exportsService = {
  async run(
    kind: ExportKind,
    filters: ExportFilters,
    format: ExportFormat,
    _userId: string,
  ) {
    const built = (await buildExportRowsFn({
      data: { kind, filters },
    })) as { columns: string[]; rows: Record<string, unknown>[] };
    const csv = toCSV(built.rows, built.columns);
    const ext = format === "xls" ? "xls" : "csv";
    downloadCSV(`${kind}-${todayISO()}.${ext}`, csv);
    await recordExportFn({
      data: {
        kind,
        filters: filters as unknown as Record<string, unknown>,
        rowCount: built.rows.length,
      },
    });
    return built.rows.length;
  },
};
