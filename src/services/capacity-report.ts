import type { CapacityReportRow } from "./exports.functions";

export const UNASSIGNED_LABEL = "Unassigned";
export const LEAVE_LABEL = "Leave";
export const UNUSED_CAPACITY_LABEL = "Unused Capacity";
export const OVER_CAPACITY_LABEL = "Over Capacity";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Percentage of a capacity denominator (one decimal, trailing ".0" dropped).
 * Never capped, so it may exceed 100%. A zero denominator gives "0%" for 0 hours, "—" otherwise.
 */
export function pctOfCapacity(hours: number, denominator: number): string {
  if (denominator <= 0) return hours > 0 ? "—" : "0%";
  return `${(Math.round((hours / denominator) * 1000) / 10).toString()}%`;
}

/**
 * Build the report rows for one member.
 *
 * projectHours: actual logged hours per project name (the "Unassigned" key holds ONLY
 *   hours of tasks without a valid project) plus an optional "Leave" key.
 *
 * Formulas (capacity = working days x daily capacity):
 *   logged    = sum(project hours incl. Unassigned, excl. Leave)
 *   available = max(0, capacity - leave)
 *   unused    = max(0, available - logged)
 *   over      = max(0, logged - available)
 *   % row     = row hours / available   (utilization, not capped; Leave row uses capacity)
 */
export function buildMemberRows(
  teamMember: string,
  projectHours: Record<string, number>,
  autoProjectHours: Record<string, number>,
  capacity: number,
): CapacityReportRow[] {
  const rows: CapacityReportRow[] = [];
  const entries = Object.entries(projectHours).filter(([, h]) => h > 0);

  let logged = 0;
  let leave = 0;
  let autoTotal = 0;
  for (const [name, h] of entries) {
    if (name === LEAVE_LABEL) leave += h;
    else {
      logged += h;
      autoTotal += autoProjectHours[name] || 0;
    }
  }

  const available = Math.max(0, capacity - leave);
  const common = {
    leaveHours: round1(leave),
    availableCapacity: round1(available),
  };

  entries.forEach(([name, h]) => {
    rows.push({
      ...common,
      teamMember,
      projectName: name,
      hours: round1(h),
      autoHours: round1(autoProjectHours[name] || 0),
      totalWorkingHours: capacity,
      pctProject: pctOfCapacity(h, name === LEAVE_LABEL ? capacity : available),
      rowType: name === LEAVE_LABEL ? "leave" : name === UNASSIGNED_LABEL ? "unassigned" : "project",
    });
  });

  const unused = Math.max(0, available - logged);
  const over = Math.max(0, logged - available);

  if (unused > 0) {
    rows.push({
      ...common,
      teamMember,
      projectName: UNUSED_CAPACITY_LABEL,
      hours: round1(unused),
      totalWorkingHours: capacity,
      pctProject: pctOfCapacity(unused, available),
      rowType: "unused",
    });
  }
  if (over > 0) {
    rows.push({
      ...common,
      teamMember,
      projectName: OVER_CAPACITY_LABEL,
      hours: round1(over),
      totalWorkingHours: capacity,
      pctProject: pctOfCapacity(over, available),
      rowType: "over",
    });
  }

  rows.push({
    ...common,
    teamMember,
    projectName: "Total",
    hours: round1(logged),
    autoHours: round1(autoTotal),
    totalWorkingHours: capacity,
    pctProject: pctOfCapacity(logged, available),
    isTotalRow: true,
    rowType: "total",
  });

  return rows;
}
