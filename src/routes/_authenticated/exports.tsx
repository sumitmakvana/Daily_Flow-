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
import { downloadCSV } from "@/lib/csv";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Download,
  FileSpreadsheet,
  RefreshCw,
  Layers,
  Users,
  Briefcase,
  ChevronDown,
  ExternalLink,
  Clock,
  ListChecks,
  Search,
  Filter,
  HelpCircle,
} from "lucide-react";
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
  const [selectedProjectModal, setSelectedProjectModal] = useState<string | null>(null);

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
            <>
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-muted-foreground font-medium text-[11px] uppercase tracking-wider">
                    <th className="py-2.5 px-4 w-1/3">Project</th>
                    <th className="py-2.5 px-4 text-right w-36">Team Hours</th>
                    <th className="py-2.5 px-4 text-right w-44">Total Hours in Month</th>
                    <th className="py-2.5 px-4 text-right w-56">
                      <div className="flex items-center justify-end gap-1.5 cursor-help" title="Resource FTE Formula = Team Hours / Total Working Hours in Month">
                        <span>No of Resources worked on (FTE)</span>
                        <HelpCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                      </div>
                    </th>
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
                          onClick={() => {
                            if (!isTotal) setSelectedProjectModal(pRow.projectName);
                          }}
                          className={cn(
                            "transition-colors group",
                            isTotal
                              ? "bg-primary/5 font-bold text-foreground border-t-2 border-border/80 cursor-default"
                              : "hover:bg-accent/40 text-foreground cursor-pointer"
                          )}
                        >
                          <td className="py-2.5 px-4 font-semibold text-foreground">
                            {isTotal ? (
                              <span>{pRow.projectName}</span>
                            ) : (
                              <span className="font-bold group-hover:text-primary transition-colors">
                                {pRow.projectName}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-400">
                            {pRow.teamHours}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                            {pRow.totalWorkingHours}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-primary">
                            <span className={cn(
                              "inline-block px-2 py-0.5 rounded text-[11px] transition-colors group-hover:bg-primary/20",
                              isTotal ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary border border-primary/20"
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

              {/* Resource FTE Formula Banner */}
              <div className="px-4 py-2 bg-muted/20 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground font-mono">
                <div className="flex items-center gap-2">
                  <HelpCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>
                    <strong className="text-foreground font-sans font-medium">Resource FTE Formula:</strong>{" "}
                    <code className="text-primary font-bold">Team Hours ÷ Total Working Hours</code> (e.g. 40.4h ÷ 168h = <strong className="text-emerald-400">0.2 FTE</strong>)
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/80 font-sans hidden sm:inline">
                  1.0 FTE = 1 Full-Time Employee for full month ({reportData?.meta.totalWorkingHours ?? 168}h)
                </span>
              </div>
            </>
          ) : (
            /* TAB 1: Member Capacity Breakdown Table */
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-muted-foreground font-medium text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-1/4">Team Member</th>
                  <th className="py-2.5 px-1 w-4"></th>
                  <th className="py-2.5 px-3 w-1/4">Project</th>
                  <th className="py-2.5 px-3 text-right w-28 text-emerald-400">User Logged</th>
                  <th className="py-2.5 px-3 text-right w-28 text-amber-400">Auto Tracked</th>
                  <th className="py-2.5 px-3 text-right w-44">Total Hours (working day in month)</th>
                  <th className="py-2.5 px-3 text-right w-28">% Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-medium">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Generating capacity report...
                    </td>
                  </tr>
                ) : !reportData?.rows.length ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                      No team member capacity records found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  reportData.rows.map((row, idx) => {
                    if (row.isSeparatorRow) {
                      return (
                        <tr key={`sep-${idx}`} className="bg-muted/30 h-3 border-y border-border/30">
                          <td colSpan={7}></td>
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
                            <button
                              type="button"
                              onClick={() => setSelectedProjectModal(row.projectName)}
                              className="font-medium text-foreground hover:text-primary hover:underline cursor-pointer text-left select-none"
                              title={`Click to view project details for ${row.projectName}`}
                            >
                              <span>{row.projectName}</span>
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium text-emerald-400">
                          {row.hours}h
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium text-amber-400">
                          {row.autoHours ?? 0}h
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

      {/* Interactive Project Details Modal */}
      {selectedProjectModal && (
        <ProjectDetailModal
          projectName={selectedProjectModal}
          onClose={() => setSelectedProjectModal(null)}
          reportData={reportData}
          onFilterByProject={(pName) => {
            setSelectedProjects([pName]);
            setActiveTab("member");
            setSelectedProjectModal(null);
          }}
        />
      )}
    </div>
  );
}

function ProjectDetailModal({
  projectName,
  onClose,
  reportData,
  onFilterByProject,
}: {
  projectName: string;
  onClose: () => void;
  reportData: {
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
  } | null;
  onFilterByProject: (pName: string) => void;
}) {
  const [activeModalTab, setActiveModalTab] = useState<"members" | "tasks">("members");
  const [projectTasks, setProjectTasks] = useState<Array<{
    id: string;
    task_code: string | null;
    task_name: string;
    status: string;
    priority: string;
    planned_hours: number | null;
    actual_hours: number | null;
    assigned_to: string | null;
    created_at: string;
    completed_at: string | null;
    assignee_name?: string;
  }>>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const memberRows = useMemo(() => {
    if (!reportData?.rows) return [];
    return reportData.rows.filter(
      (r) => !r.isTotalRow && !r.isSeparatorRow && r.projectName === projectName && r.hours > 0
    );
  }, [reportData, projectName]);

  const totalProjectHours = useMemo(() => {
    return memberRows.reduce((acc, m) => acc + m.hours, 0);
  }, [memberRows]);

  const projectSummaryMeta = useMemo(() => {
    return reportData?.projectSummary?.find((p) => p.projectName === projectName);
  }, [reportData, projectName]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTasks(true);

    (async () => {
      try {
        const { data: prjData } = await supabase
          .from("projects")
          .select("id")
          .eq("name", projectName)
          .maybeSingle();

        let query = supabase
          .from("tasks")
          .select(`
            id,
            task_code,
            task_name,
            status,
            priority,
            planned_hours,
            actual_hours,
            assigned_to,
            created_at,
            completed_at,
            project_name,
            project_id
          `)
          .order("updated_at", { ascending: false });

        if (prjData?.id) {
          query = query.or(`project_name.eq."${projectName}",project_id.eq."${prjData.id}"`);
        } else {
          query = query.eq("project_name", projectName);
        }

        const { data: tasks, error } = await query;
        if (error) throw error;

        // Filter tasks by report date bounds (from - to) if present
        const fromStr = reportData?.meta?.from;
        const toStr = reportData?.meta?.to;
        let activePeriodTasks = tasks ?? [];

        if (fromStr && toStr) {
          activePeriodTasks = activePeriodTasks.filter((t) => {
            const cDate = t.created_at ? t.created_at.slice(0, 10) : "";
            const compDate = t.completed_at ? t.completed_at.slice(0, 10) : "";
            if (cDate && cDate >= fromStr && cDate <= toStr) return true;
            if (compDate && compDate >= fromStr && compDate <= toStr) return true;
            if (!cDate || cDate <= toStr) return true;
            return false;
          });
        }

        const assignedUserIds = Array.from(
          new Set(activePeriodTasks.map((t) => t.assigned_to).filter(Boolean))
        ) as string[];

        let profileMap: Record<string, string> = {};
        if (assignedUserIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("id", assignedUserIds);

          (profs ?? []).forEach((p) => {
            profileMap[p.id] = p.display_name;
          });
        }

        const formatted = activePeriodTasks.map((t) => ({
          ...t,
          assignee_name: t.assigned_to ? profileMap[t.assigned_to] || "Unassigned" : "Unassigned",
        }));

        if (!cancelled) setProjectTasks(formatted);
      } catch (err) {
        console.warn("Failed to fetch project tasks:", err);
      } finally {
        if (!cancelled) setLoadingTasks(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectName]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return projectTasks;
    return projectTasks.filter(
      (t) =>
        t.task_name.toLowerCase().includes(q) ||
        (t.task_code && t.task_code.toLowerCase().includes(q)) ||
        (t.assignee_name && t.assignee_name.toLowerCase().includes(q)) ||
        t.status.toLowerCase().includes(q)
    );
  }, [projectTasks, searchQuery]);

  const exportProjectDetailsCSV = () => {
    if (!memberRows.length && !projectTasks.length) {
      toast.error("No data to export");
      return;
    }
    const cleanProjName = projectName.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `Project_${cleanProjName}_Breakdown.csv`;

    const csvLines: string[] = [];
    csvLines.push(`Project Breakdown: ${projectName}`);
    csvLines.push(`Period: ${reportData?.meta.monthLabel || ""}`);
    csvLines.push(`Total Team Hours: ${totalProjectHours}h`);
    csvLines.push(`Resource Count (FTE): ${projectSummaryMeta?.noOfResources || 0}`);
    csvLines.push("");
    csvLines.push("MEMBER BREAKDOWN");
    csvLines.push("Team Member,Logged Hours,Auto-Tracked Hours,% Contribution of Project");

    memberRows.forEach((m) => {
      const pctOfProj = totalProjectHours > 0 ? Math.round((m.hours / totalProjectHours) * 100) : 0;
      csvLines.push(`"${m.teamMember}",${m.hours},${m.autoHours || 0},${pctOfProj}%`);
    });

    csvLines.push("");
    csvLines.push("TASKS LIST");
    csvLines.push("Task Code,Task Name,Assignee,Status,Planned Hours,Actual Hours,Created Date");

    projectTasks.forEach((t) => {
      const cDate = t.created_at ? t.created_at.slice(0, 10) : "";
      csvLines.push(`"${t.task_code || ''}","${t.task_name.replace(/"/g, '""')}","${t.assignee_name}",${t.status},${t.planned_hours || 0},${t.actual_hours || 0},${cDate}`);
    });

    const csvContent = csvLines.join("\n");
    downloadCSV(filename, csvContent);
    toast.success(`Exported ${filename}`);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] p-0 overflow-hidden bg-card border border-border shadow-2xl rounded-xl flex flex-col">
        {/* Modal Header */}
        <DialogHeader className="p-4 md:p-5 bg-muted/20 border-b border-border/80 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                  <span>{projectName}</span>
                  <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 rounded bg-muted/60 border border-border/40 font-mono">
                    {reportData?.meta.monthLabel}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Detailed resource allocation, member hours, and task breakdown for {projectName}
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
            <div className="p-2 rounded-lg bg-background/60 border border-border/50 flex flex-col">
              <span className="text-[10px] text-muted-foreground uppercase font-sans">Total Team Hours</span>
              <span className="text-base font-bold text-emerald-400">{Math.round(totalProjectHours * 10) / 10}h</span>
            </div>
            <div className="p-2 rounded-lg bg-background/60 border border-border/50 flex flex-col">
              <span className="text-[10px] text-muted-foreground uppercase font-sans">Resource FTE</span>
              <span className="text-base font-bold text-primary">{projectSummaryMeta?.noOfResources ?? 0}</span>
            </div>
            <div className="p-2 rounded-lg bg-background/60 border border-border/50 flex flex-col">
              <span className="text-[10px] text-muted-foreground uppercase font-sans">Active Members</span>
              <span className="text-base font-bold text-foreground">{memberRows.length}</span>
            </div>
            <div className="p-2 rounded-lg bg-background/60 border border-border/50 flex flex-col">
              <span className="text-[10px] text-muted-foreground uppercase font-sans">Total Tasks</span>
              <span className="text-base font-bold text-amber-400">{loadingTasks ? "..." : projectTasks.length}</span>
            </div>
          </div>
        </DialogHeader>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-muted/10">
          <div className="flex items-center gap-1.5 p-0.5 bg-input/40 border border-border rounded-lg">
            <button
              type="button"
              onClick={() => setActiveModalTab("members")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
                activeModalTab === "members"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Team Members ({memberRows.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveModalTab("tasks")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
                activeModalTab === "tasks"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span>Tasks & Work Items ({projectTasks.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={exportProjectDetailsCSV}
              className="h-7 text-xs font-medium border-border hover:bg-accent text-foreground cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeModalTab === "members" ? (
            /* TAB 1: Team Member Breakdown */
            <div className="space-y-3">
              {memberRows.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground italic">
                  No member activity logged for this project in the selected period.
                </div>
              ) : (
                <div className="border border-border/80 rounded-lg overflow-hidden bg-card">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border text-muted-foreground font-medium text-[11px] uppercase tracking-wider">
                        <th className="py-2.5 px-4">Team Member</th>
                        <th className="py-2.5 px-4 text-right">Logged Hours</th>
                        <th className="py-2.5 px-4 text-right">Auto Hours</th>
                        <th className="py-2.5 px-4 text-right">% of Project</th>
                        <th className="py-2.5 px-4 w-44">Workload Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-medium">
                      {memberRows.map((m, idx) => {
                        const pctOfProj = totalProjectHours > 0 ? Math.round((m.hours / totalProjectHours) * 100) : 0;
                        const initial = (m.teamMember || "U").charAt(0).toUpperCase();

                        const memberLeaveRow = reportData?.rows?.find(
                          (r) => r.teamMember === m.teamMember && r.projectName === "Leave" && r.hours > 0
                        );

                        return (
                          <tr key={idx} className="hover:bg-accent/30 text-foreground transition-colors">
                            <td className="py-2.5 px-4 font-semibold flex items-center gap-2.5">
                              <div className="h-7 w-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold border border-primary/30 shrink-0 font-mono">
                                {initial}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-foreground font-semibold">{m.teamMember}</span>
                                {memberLeaveRow && (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono"
                                    title={`${m.teamMember} took ${memberLeaveRow.hours}h leave in ${reportData?.meta.monthLabel}`}
                                  >
                                    <span>{memberLeaveRow.hours}h Leave in Month</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-400">
                              {m.hours}h
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-amber-400">
                              {m.autoHours ?? 0}h
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold text-primary">
                              {pctOfProj}%
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="w-full bg-input/60 rounded-full h-2 overflow-hidden border border-border/40">
                                <div
                                  className="bg-primary h-full rounded-full transition-all duration-300"
                                  style={{ width: `${Math.min(pctOfProj, 100)}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* TAB 2: Tasks List */
            <div className="space-y-3">
              {/* Task Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter tasks by code, title, assignee, or status..."
                  className="h-8 text-xs bg-input/40 border-border text-foreground pl-9 pr-3"
                />
              </div>

              {loadingTasks ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  Loading project tasks...
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground italic">
                  {searchQuery ? "No tasks matching your search." : "No tasks found for this project."}
                </div>
              ) : (
                <div className="border border-border/80 rounded-lg overflow-hidden bg-card">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border text-muted-foreground font-medium text-[11px] uppercase tracking-wider">
                        <th className="py-2.5 px-3 w-28 font-mono">Task Code</th>
                        <th className="py-2.5 px-3">Task Name</th>
                        <th className="py-2.5 px-3 w-36">Assignee</th>
                        <th className="py-2.5 px-3 w-28">Status</th>
                        <th className="py-2.5 px-3 text-right w-24">Logged / Plan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-medium">
                      {filteredTasks.map((t) => (
                        <tr key={t.id} className="hover:bg-accent/30 text-foreground transition-colors">
                          <td className="py-2 px-3 font-mono font-semibold text-primary">
                            {t.task_code || "TSK-—"}
                          </td>
                          <td className="py-2 px-3 font-medium text-foreground">
                            {t.task_name}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {t.assignee_name}
                          </td>
                          <td className="py-2 px-3">
                            <StatusBadge status={t.status as any} />
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-400">
                            {t.actual_hours ?? t.planned_hours ?? 0}h
                            {t.planned_hours ? (
                              <span className="text-[10px] text-muted-foreground font-normal ml-1">
                                / {t.planned_hours}h
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <DialogFooter className="p-3 bg-muted/20 border-t border-border/80 flex items-center justify-between gap-2 sm:justify-between">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onFilterByProject(projectName)}
            className="h-8 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 cursor-pointer"
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" /> Filter Main Report by {projectName}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="h-8 text-xs font-medium border-border hover:bg-accent text-foreground cursor-pointer"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
