import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  exportsService,
  exportMemberCapacityToExcel,
  exportProjectSummaryToExcel,
  exportCapacityReportToCSV,
  exportProjectSummaryToCSV,
  type CapacityReportRow,
  type ProjectSummaryRow,
} from "@/services/exports";
import type { Profile, Team } from "@/lib/types";
import { Download, FileSpreadsheet, RefreshCw, Layers, Users, Briefcase, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/exports")({
  component: ExportsPage,
});

interface ProjectItem {
  id: string;
  name: string;
}

function MultiSelectFilter({
  label,
  options,
  selectedValues,
  onChange,
  placeholder,
  widthClass = "w-52",
}: {
  label: string;
  options: { label: string; value: string }[];
  selectedValues: string[];
  onChange: (vals: string[]) => void;
  placeholder: string;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);

  const toggleOption = (val: string) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  const isAll = selectedValues.length === 0;

  const displayText = isAll
    ? placeholder
    : selectedValues.length === 1
    ? options.find((o) => o.value === selectedValues[0])?.label || selectedValues[0]
    : `${selectedValues.length} Selected`;

  return (
    <div className={cn("space-y-1 relative", widthClass)}>
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="h-8 w-full px-2.5 text-xs bg-input/40 border border-border rounded-md text-foreground flex items-center justify-between gap-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:bg-accent/40"
        >
          <span className="truncate text-left font-medium">{displayText}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-9 z-50 w-56 p-2 bg-card border border-border rounded-lg shadow-xl text-xs space-y-1 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-border/60 text-[11px]">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className={cn(
                    "text-xs font-semibold cursor-pointer",
                    isAll ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All ({options.length})
                </button>
                {selectedValues.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {!options.length ? (
                <div className="py-2 text-center text-muted-foreground text-[11px]">
                  No items available
                </div>
              ) : (
                options.map((opt) => {
                  const checked = selectedValues.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-foreground text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOption(opt.value)}
                        className="rounded border-border bg-input text-primary focus:ring-0 cursor-pointer h-3.5 w-3.5"
                      />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExportsPage() {
  const { user, isManager } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  
  // Current month string (YYYY-MM) e.g., "2026-08"
  const defaultMonth = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

  const [activeTab, setActiveTab] = useState<"member" | "project">("member");
  const [dateMode, setDateMode] = useState<"month" | "custom">("month");
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  const [reportData, setReportData] = useState<{
    meta: {
      monthLabel: string;
      from: string;
      to: string;
      totalWorkingDays: number;
      dailyCapacityHours: number;
      totalWorkingHours: number;
      totalMembers: number;
    };
    rows: CapacityReportRow[];
    projectSummary?: ProjectSummaryRow[];
    availableProjects?: string[];
  } | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("id,display_name,avatar_url,team_id").order("display_name"),
      supabase.from("teams").select("id,name").order("name"),
      supabase.from("projects").select("id,name").order("name"),
    ]).then(([{ data: profs }, { data: tms }, { data: prjs }]) => {
      setProfiles((profs ?? []) as Profile[]);
      setTeams((tms ?? []) as Team[]);
      setProjects((prjs ?? []) as ProjectItem[]);
    });
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const filters = dateMode === "month"
        ? {
            month: selectedMonth,
            teamId: selectedTeamId,
            userIds: selectedUserIds.length ? selectedUserIds : undefined,
            projects: selectedProjects.length ? selectedProjects : undefined,
          }
        : {
            from: customFrom || undefined,
            to: customTo || undefined,
            teamId: selectedTeamId,
            userIds: selectedUserIds.length ? selectedUserIds : undefined,
            projects: selectedProjects.length ? selectedProjects : undefined,
          };

      const res = await exportsService.getMonthlyCapacityReport(filters);
      setReportData(res);
    } catch (e) {
      toast.error("Failed to generate report: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchReport();
    }
  }, [user, dateMode, selectedMonth, customFrom, customTo, selectedTeamId, selectedUserIds, selectedProjects]);

  if (!user) return null;

  const filteredProfiles = profiles.filter((p) => {
    if (selectedTeamId !== "all" && p.team_id !== selectedTeamId) return false;
    return true;
  });

  const memberOptions = filteredProfiles.map((p) => ({
    label: p.display_name,
    value: p.id,
  }));

  // Combine DB projects table and tasks project_name strings
  const allProjectNames = Array.from(
    new Set([
      ...projects.map((p) => p.name).filter(Boolean),
      ...(reportData?.availableProjects || []),
    ])
  ).sort();

  const projectOptions = allProjectNames.map((pName) => ({
    label: pName,
    value: pName,
  }));

  // Dynamic export handlers based on active tab
  const handleExportExcel = () => {
    if (!reportData) return;
    const cleanLabel = reportData.meta.monthLabel.replace(/[^a-zA-Z0-9]/g, "_");

    if (activeTab === "member") {
      if (!reportData.rows.length) {
        toast.error("No member capacity data to export");
        return;
      }
      const filename = `Monthly_Member_Capacity_${cleanLabel}.xlsx`;
      exportMemberCapacityToExcel(reportData.meta.monthLabel, reportData.rows, filename);
      toast.success(`Exported Member Capacity Excel (${filename})`);
    } else {
      if (!reportData.projectSummary?.length) {
        toast.error("No project summary data to export");
        return;
      }
      const filename = `Project_Summary_${cleanLabel}.xlsx`;
      exportProjectSummaryToExcel(reportData.meta.monthLabel, reportData.projectSummary, filename);
      toast.success(`Exported Project Summary Excel (${filename})`);
    }
  };

  const handleExportCSV = () => {
    if (!reportData) return;
    const cleanLabel = reportData.meta.monthLabel.replace(/[^a-zA-Z0-9]/g, "_");

    if (activeTab === "member") {
      if (!reportData.rows.length) {
        toast.error("No member capacity data to export");
        return;
      }
      const filename = `Monthly_Member_Capacity_${cleanLabel}.csv`;
      exportCapacityReportToCSV(reportData.meta.monthLabel, reportData.rows, filename);
      toast.success(`Exported Member Capacity CSV (${filename})`);
    } else {
      if (!reportData.projectSummary?.length) {
        toast.error("No project summary data to export");
        return;
      }
      const filename = `Project_Summary_${cleanLabel}.csv`;
      exportProjectSummaryToCSV(reportData.meta.monthLabel, reportData.projectSummary, filename);
      toast.success(`Exported Project Summary CSV (${filename})`);
    }
  };

  const isCurrentTabEmpty = activeTab === "member"
    ? !reportData?.rows.length
    : !reportData?.projectSummary?.length;

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-6 py-5 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2 text-foreground tracking-tight">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Reports & Capacity Analytics
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Export team member capacity allocation or overall project resource FTE reports in Excel (.xlsx) or CSV (.csv)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={handleExportExcel}
            disabled={loading || isCurrentTabEmpty}
            className="h-8 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Download Excel (.xlsx)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            disabled={loading || isCurrentTabEmpty}
            className="h-8 text-xs font-medium border-border hover:bg-accent text-foreground transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download CSV (.csv)
          </Button>
        </div>
      </div>

      {/* Prominent Top Report Selection Tabs */}
      <div className="flex items-center gap-2 p-1 bg-card border border-border/80 rounded-xl shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab("member")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer",
            activeTab === "member"
              ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
          )}
        >
          <Users className="h-4 w-4" />
          <span>Member Capacity Breakdown</span>
        </button>
        
        <button
          type="button"
          onClick={() => setActiveTab("project")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer",
            activeTab === "project"
              ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
          )}
        >
          <Briefcase className="h-4 w-4" />
          <span>Project Hours & Resources</span>
        </button>
      </div>

      {/* Filter Controls Card */}
      <Card className="p-4 bg-card border-border/80 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-primary" /> Report Scope & Multi-Filters
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchReport}
            disabled={loading}
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground border border-border/40 hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} /> Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3.5">
          {/* 1. Date Range Mode Switcher */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Selection Mode</label>
            <div className="flex items-center p-0.5 bg-input/40 border border-border rounded-md h-8">
              <button
                type="button"
                onClick={() => setDateMode("month")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer",
                  dateMode === "month"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                By Month
              </button>
              <button
                type="button"
                onClick={() => setDateMode("custom")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer",
                  dateMode === "custom"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Custom Dates
              </button>
            </div>
          </div>

          {/* 2. Date Input(s) */}
          {dateMode === "month" ? (
            <div className="space-y-1 w-48">
              <label className="text-[11px] font-medium text-muted-foreground">Select Month</label>
              <Input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value || defaultMonth)}
                onClick={(e) => {
                  try { e.currentTarget.showPicker(); } catch {}
                }}
                style={{ colorScheme: "dark" }}
                className="h-8 text-xs bg-input/40 border-border text-foreground cursor-pointer focus-visible:ring-1 focus-visible:ring-primary font-mono"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="space-y-1 w-36">
                <label className="text-[11px] font-medium text-muted-foreground">From Date</label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  onClick={(e) => {
                    try { e.currentTarget.showPicker(); } catch {}
                  }}
                  style={{ colorScheme: "dark" }}
                  className="h-8 text-xs bg-input/40 border-border text-foreground cursor-pointer focus-visible:ring-1 focus-visible:ring-primary font-mono"
                />
              </div>
              <div className="space-y-1 w-36">
                <label className="text-[11px] font-medium text-muted-foreground">To Date</label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  onClick={(e) => {
                    try { e.currentTarget.showPicker(); } catch {}
                  }}
                  style={{ colorScheme: "dark" }}
                  className="h-8 text-xs bg-input/40 border-border text-foreground cursor-pointer focus-visible:ring-1 focus-visible:ring-primary font-mono"
                />
              </div>
            </div>
          )}

          {/* 3. Multi-Select Project Filter */}
          <MultiSelectFilter
            label="Project Filter (Multi-Select)"
            placeholder="All Projects"
            options={projectOptions}
            selectedValues={selectedProjects}
            onChange={setSelectedProjects}
            widthClass="w-52"
          />

          {/* 4. Team Filter */}
          <div className="space-y-1 w-44">
            <label className="text-[11px] font-medium text-muted-foreground">Team Filter</label>
            <Select value={selectedTeamId} onValueChange={(v) => { setSelectedTeamId(v); setSelectedUserIds([]); }}>
              <SelectTrigger className="h-8 text-xs bg-input/40 border-border text-foreground">
                <SelectValue placeholder="All Teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 5. Multi-Select Team Member Filter */}
          <MultiSelectFilter
            label="Team Member Filter (Multi-Select)"
            placeholder="All Members"
            options={memberOptions}
            selectedValues={selectedUserIds}
            onChange={setSelectedUserIds}
            widthClass="w-52"
          />
        </div>
      </Card>

      {/* Active Table Preview Card */}
      <Card className="bg-card border-border/80 shadow-sm overflow-hidden">
        {/* Table Subheader Metadata */}
        <div className="p-3 border-b border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <span>
              {activeTab === "member" ? "Member Capacity Breakdown" : "Project Hours & Resources"}
            </span>
            <span className="text-muted-foreground font-normal">•</span>
            <span className="text-primary font-mono">{reportData?.meta.monthLabel ?? selectedMonth}</span>
          </div>
          {reportData?.meta && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
              <span>Working Days: <strong className="text-foreground">{reportData.meta.totalWorkingDays}d</strong></span>
              <span>•</span>
              <span>Total Hours: <strong className="text-foreground">{reportData.meta.totalWorkingHours}h</strong></span>
              <span>•</span>
              <span>Members: <strong className="text-foreground">{reportData.meta.totalMembers}</strong></span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {activeTab === "project" ? (
            /* TAB 2: Project Hours & Resources Table */
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-muted-foreground font-medium text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-4 w-1/3">Project</th>
                  <th className="py-2.5 px-4 text-right w-36">Team Hours</th>
                  <th className="py-2.5 px-4 text-right w-44">Total Hours in Month</th>
                  <th className="py-2.5 px-4 text-right w-48">No of Resources worked on</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-medium">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-xs text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Generating project summary...
                    </td>
                  </tr>
                ) : !reportData?.projectSummary?.length ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-xs text-muted-foreground">
                      No project activity found for the selected date range.
                    </td>
                  </tr>
                ) : (
                  reportData.projectSummary.map((pRow, idx) => {
                    const isTotal = pRow.isTotalRow;
                    return (
                      <tr
                        key={idx}
                        className={cn(
                          "transition-colors",
                          isTotal
                            ? "bg-primary/5 font-bold text-foreground border-t-2 border-border/80"
                            : "hover:bg-accent/30 text-foreground"
                        )}
                      >
                        <td className="py-2.5 px-4 font-semibold text-foreground">
                          {pRow.projectName}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-400">
                          {pRow.teamHours}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                          {pRow.totalWorkingHours}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-primary">
                          <span className={cn(
                            "inline-block px-2 py-0.5 rounded text-[11px]",
                            isTotal ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"
                          )}>
                            {pRow.noOfResources}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            /* TAB 1: Member Capacity Breakdown Table */
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-muted-foreground font-medium text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-1/4">Team Member</th>
                  <th className="py-2.5 px-1 w-8"></th>
                  <th className="py-2.5 px-3 w-1/4">Project</th>
                  <th className="py-2.5 px-3 text-right w-24">Hours</th>
                  <th className="py-2.5 px-3 text-right w-44">Total Hours (working day in month)</th>
                  <th className="py-2.5 px-3 text-right w-28">% Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-medium">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Generating capacity report...
                    </td>
                  </tr>
                ) : !reportData?.rows.length ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                      No team member capacity records found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  reportData.rows.map((row, idx) => {
                    if (row.isSeparatorRow) {
                      return (
                        <tr key={`sep-${idx}`} className="bg-muted/30 h-3 border-y border-border/30">
                          <td colSpan={6}></td>
                        </tr>
                      );
                    }

                    const isTotal = row.isTotalRow;
                    const isLeave = row.projectName === "Leave";
                    const isUnassigned = row.projectName === "Unassigned";

                    return (
                      <tr
                        key={idx}
                        className={cn(
                          "transition-colors",
                          isTotal
                            ? "bg-primary/5 font-semibold text-foreground border-t border-border/80"
                            : "hover:bg-accent/30 text-foreground",
                          isLeave && "bg-amber-500/5 text-amber-300/90",
                          isUnassigned && "text-muted-foreground/80"
                        )}
                      >
                        <td className="py-2 px-3 font-semibold">
                          {!isTotal && row.teamMember}
                        </td>
                        <td className="py-2 px-1"></td>
                        <td className="py-2 px-3">
                          {isLeave ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Leave
                            </span>
                          ) : isUnassigned ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground border border-border/40">
                              Unassigned
                            </span>
                          ) : isTotal ? (
                            <span className="font-bold text-foreground">Total</span>
                          ) : (
                            <span className="font-medium text-foreground">{row.projectName}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium">
                          {row.hours}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                          {row.totalWorkingHours}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold">
                          <span
                            className={cn(
                              "inline-block px-1.5 py-0.5 rounded text-[11px]",
                              isTotal && "bg-primary/10 text-primary font-bold",
                              isLeave && "text-amber-400",
                              !isTotal && !isLeave && !isUnassigned && "text-emerald-400"
                            )}
                          >
                            {row.pctProject}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
