import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { leavesService } from "@/services/leaves";
import { LeaveDialog } from "@/components/LeaveDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Calendar,
  Check,
  X,
  Search,
  Plus,
  Palmtree,
  Home,
  Clock,
  Trash2,
  RefreshCw,
  Users,
  Filter,
  CheckCircle2,
  XCircle,
  Clock3,
} from "lucide-react";
import type { Leave } from "@/lib/types";
import { cn } from "@/lib/utils";
import { leaveColor, leaveDot } from "@/lib/colors";

export const Route = createFileRoute("/_authenticated/leaves")({
  component: TeamMemberLeavesPage,
});

export function TeamMemberLeavesPage() {
  const { user } = useAuth();
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("__all");
  const [typeFilter, setTypeFilter] = useState<string>("__all");
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const data = await leavesService.getLeaves();
      setLeaves(data);
    } catch (err) {
      toast.error("Failed to load leaves: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeaves();
  }, [loadLeaves]);

  // Actions
  const handleApprove = async (id: string) => {
    setActionLoadingId(id);
    try {
      await leavesService.updateStatus(id, "approved");
      toast.success("Leave request approved!");
      await loadLeaves();
    } catch (err) {
      toast.error("Failed to approve leave: " + (err as Error).message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoadingId(id);
    try {
      await leavesService.updateStatus(id, "rejected");
      toast.success("Leave request rejected.");
      await loadLeaves();
    } catch (err) {
      toast.error("Failed to reject leave: " + (err as Error).message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Are you sure you want to cancel this leave record?")) return;
    setActionLoadingId(id);
    try {
      await leavesService.deleteLeave(id, "Cancelled by manager/admin");
      toast.success("Leave record cancelled.");
      await loadLeaves();
    } catch (err) {
      toast.error("Failed to cancel leave: " + (err as Error).message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Format date helper (e.g. 31-Aug-24)
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = d.getDate().toString().padStart(2, "0");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = monthNames[d.getMonth()];
      const year = d.getFullYear().toString().slice(-2);
      return `${day}-${month}-${year}`;
    } catch {
      return dateStr;
    }
  };

  // Metrics
  const metrics = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const pending = leaves.filter((l) => l.status === "pending").length;
    const onLeaveToday = leaves.filter(
      (l) => l.status === "approved" && l.leave_type !== "wfh" && todayStr >= l.start_date && todayStr <= l.end_date
    ).length;
    const wfhToday = leaves.filter(
      (l) => l.status === "approved" && l.leave_type === "wfh" && todayStr >= l.start_date && todayStr <= l.end_date
    ).length;
    return { pending, onLeaveToday, wfhToday, total: leaves.length };
  }, [leaves]);

  // Filtered leaves
  const filteredLeaves = useMemo(() => {
    return leaves.filter((l) => {
      if (statusFilter !== "__all" && l.status !== statusFilter) return false;
      if (typeFilter !== "__all" && l.leave_type !== typeFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const nameMatch = (l.user_name || "").toLowerCase().includes(q);
        const reasonMatch = (l.reason || "").toLowerCase().includes(q);
        const reqMatch = (l.request_to_name || "").toLowerCase().includes(q);
        const typeMatch = (l.leave_type || "").toLowerCase().includes(q);
        if (!nameMatch && !reasonMatch && !reqMatch && !typeMatch) return false;
      }
      return true;
    });
  }, [leaves, statusFilter, typeFilter, search]);

  // Pagination
  const paginatedLeaves = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeaves.slice(start, start + pageSize);
  }, [filteredLeaves, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredLeaves.length / pageSize) || 1;

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4">
      {/* Top Banner & Header matching screenshot */}
      <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary tracking-wider uppercase">
            <Users className="h-3.5 w-3.5" /> Team Member Leaves
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Leave & WFH Management
          </h1>
          <p className="text-xs text-muted-foreground">
            Review, approve, and track all team availability, time-off requests, and work-from-home schedules.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={loadLeaves}
            disabled={loading}
            className="h-8 text-xs gap-1 border-border"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setLeaveDialogOpen(true)}
            className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Apply Leave / WFH
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-border bg-card shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Pending Approvals</span>
            <Clock3 className="h-4 w-4 text-status-hold" />
          </div>
          <div className="text-2xl font-bold text-status-hold">{metrics.pending}</div>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">On Leave Today</span>
            <Palmtree className="h-4 w-4 text-status-review" />
          </div>
          <div className="text-2xl font-bold text-status-review">{metrics.onLeaveToday}</div>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">WFH Today</span>
            <Home className="h-4 w-4 text-status-progress" />
          </div>
          <div className="text-2xl font-bold text-status-progress">{metrics.wfhToday}</div>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Total Records</span>
            <Calendar className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground">{metrics.total}</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        {/* Table Top Controls Bar (Show entries & Search Box) */}
        <div className="p-3 sm:p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Show</span>
            <Select value={pageSize.toString()} onValueChange={(val) => { setPageSize(Number(val)); setCurrentPage(1); }}>
              <SelectTrigger className="h-8 w-16 text-xs bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="5" className="text-xs">5</SelectItem>
                <SelectItem value="10" className="text-xs">10</SelectItem>
                <SelectItem value="25" className="text-xs">25</SelectItem>
                <SelectItem value="50" className="text-xs">50</SelectItem>
              </SelectContent>
            </Select>
            <span>entries</span>

            {/* Quick Status Tabs */}
            <div className="hidden md:flex items-center gap-1 ml-4 border-l border-border pl-4">
              {[
                { id: "__all", label: "All" },
                { id: "pending", label: "Pending" },
                { id: "approved", label: "Approved" },
                { id: "rejected", label: "Rejected" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => { setStatusFilter(tab.id); setCurrentPage(1); }}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer",
                    statusFilter === tab.id
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {tab.label}
                  {tab.id === "pending" && metrics.pending > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-status-hold/30 text-status-hold text-[10px] font-bold">
                      {metrics.pending}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Type here to search..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="h-8 pl-8 text-xs bg-background border-border"
            />
          </div>
        </div>

        {/* The Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold">
                <th className="py-3 px-3 sm:px-4 w-12 text-center">Sr.</th>
                <th className="py-3 px-3 sm:px-4">Employee</th>
                <th className="py-3 px-3 sm:px-4">Apply Date</th>
                <th className="py-3 px-3 sm:px-4">From Date</th>
                <th className="py-3 px-3 sm:px-4">To Date</th>
                <th className="py-3 px-3 sm:px-4">Duration</th>
                <th className="py-3 px-3 sm:px-4">Request To</th>
                <th className="py-3 px-3 sm:px-4 min-w-[150px]">Reason for leave</th>
                <th className="py-3 px-3 sm:px-4 text-center">Status</th>
                <th className="py-3 px-3 sm:px-4 text-center min-w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                    Loading leave records...
                  </td>
                </tr>
              ) : paginatedLeaves.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <Palmtree className="h-7 w-7 mx-auto mb-2 text-muted-foreground/50" />
                    No leave or WFH records found.
                  </td>
                </tr>
              ) : (
                paginatedLeaves.map((l, index) => {
                  const srNo = (currentPage - 1) * pageSize + index + 1;
                  const isWfh = l.leave_type === "wfh";
                  const isHalfDay = l.leave_type === "half_day" || l.days_count === 0.5;
                  const daysDisplay = `${l.days_count ?? 1} ${l.days_count === 1 ? "day" : "days"} (${isHalfDay ? "Half day" : isWfh ? "WFH" : "Full day"})`;
                  const colorClass = leaveColor[l.leave_type] || leaveColor.casual;
                  const dotClass = leaveDot[l.leave_type] || leaveDot.casual;
                  const initials = (l.user_name || "TM")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <tr
                      key={l.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      {/* Sr. No. */}
                      <td className="py-3.5 px-3 sm:px-4 font-medium text-muted-foreground text-center">
                        {srNo}
                      </td>

                      {/* Name & Type */}
                      <td className="py-3.5 px-3 sm:px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {initials}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground text-xs">
                              {l.user_name || "Team Member"}
                            </div>
                            <span className={cn(
                              "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.2 rounded font-medium border mt-0.5",
                              colorClass
                            )}>
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClass)} />
                              {isWfh ? "WFH" : l.leave_type.replace("_", " ").toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Apply Date */}
                      <td className="py-3.5 px-3 sm:px-4 text-muted-foreground whitespace-nowrap">
                        {formatDate(l.created_at)}
                      </td>

                      {/* From Date */}
                      <td className="py-3.5 px-3 sm:px-4 text-foreground font-semibold whitespace-nowrap">
                        {formatDate(l.start_date)}
                      </td>

                      {/* To Date */}
                      <td className="py-3.5 px-3 sm:px-4 text-foreground font-semibold whitespace-nowrap">
                        {formatDate(l.end_date)}
                      </td>

                      {/* Duration */}
                      <td className="py-3.5 px-3 sm:px-4 whitespace-nowrap font-medium text-muted-foreground">
                        <span className="bg-muted/40 px-2 py-0.5 rounded border border-border/60">
                          {daysDisplay}
                        </span>
                      </td>

                      {/* Request To */}
                      <td className="py-3.5 px-3 sm:px-4 text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground font-medium">{l.request_to_name || "Manager / Admin"}</span>
                        </div>
                      </td>

                      {/* Reason */}
                      <td className="py-3.5 px-3 sm:px-4 text-foreground/90 max-w-xs" title={l.reason}>
                        {l.reason ? (
                          <span className="text-xs">{l.reason}</span>
                        ) : (
                          <span className="text-muted-foreground/50 italic text-[11px]">No reason specified</span>
                        )}
                        {l.handover_note && (
                          <div className="text-[10px] text-muted-foreground italic mt-0.5">
                            Handover: {l.handover_note}
                          </div>
                        )}
                      </td>

                      {/* Status Column */}
                      <td className="py-3.5 px-3 sm:px-4 text-center whitespace-nowrap">
                        {l.status === "pending" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-hold/15 text-status-hold border border-status-hold/40 shadow-xs">
                            <Clock3 className="h-3 w-3 animate-pulse" /> Pending
                          </span>
                        ) : l.status === "approved" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-completed/15 text-status-completed border border-status-completed/40 shadow-xs">
                            <CheckCircle2 className="h-3 w-3" /> Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-blocked/15 text-status-blocked border border-status-blocked/40 shadow-xs">
                            <XCircle className="h-3 w-3" /> Rejected
                          </span>
                        )}
                      </td>

                      {/* Actions Column */}
                      <td className="py-3.5 px-3 sm:px-4 text-center whitespace-nowrap">
                        {l.status === "pending" ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(l.id)}
                              disabled={actionLoadingId === l.id}
                              className="h-7 px-2.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md cursor-pointer shadow-xs gap-1"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReject(l.id)}
                              disabled={actionLoadingId === l.id}
                              className="h-7 px-2.5 text-[11px] font-bold text-destructive border-destructive/40 hover:bg-destructive/15 rounded-md cursor-pointer shadow-xs gap-1"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </Button>
                          </div>
                        ) : l.status === "approved" ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCancel(l.id)}
                              disabled={actionLoadingId === l.id}
                              className="h-7 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 border-border hover:border-destructive/30 rounded-md cursor-pointer transition-colors gap-1"
                            >
                              <Trash2 className="h-3 w-3" /> Cancel Leave
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleApprove(l.id)}
                              disabled={actionLoadingId === l.id}
                              className="h-7 px-2 text-[10px] text-muted-foreground hover:text-status-completed hover:bg-status-completed/10 border-border rounded-md cursor-pointer gap-1"
                            >
                              <Check className="h-3 w-3" /> Re-approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCancel(l.id)}
                              disabled={actionLoadingId === l.id}
                              className="h-7 px-2 text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>


        {/* Pagination Footer */}
        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-muted/10">
          <div>
            Showing {filteredLeaves.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
            {Math.min(currentPage * pageSize, filteredLeaves.length)} of {filteredLeaves.length} entries
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="h-7 px-2 text-xs border-border"
            >
              Previous
            </Button>
            <span className="px-2 font-medium text-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="h-7 px-2 text-xs border-border"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Leave Application Modal */}
      <LeaveDialog
        open={leaveDialogOpen}
        onOpenChange={setLeaveDialogOpen}
        onSuccess={loadLeaves}
      />
    </div>
  );
}
