import { loadPeopleDetailedSafe } from "@/lib/people";
import { searchTaskPage, searchTaskCounts, searchMembers, fetchFullTask, resetTaskSearch, type TaskSearchRow, type TabCounts } from "@/lib/task-search";
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  ListChecks,
  Users,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  X,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import type { Task, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

interface GlobalSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreateTask?: () => void;
}

type FilterTab = "all" | "in_progress" | "pending" | "completed" | "in_review" | "members";

const PAGE_SIZE = 6;

export function GlobalSearchModal({ open, onOpenChange, onOpenCreateTask }: GlobalSearchModalProps) {
  const { user: authUser, isManager: authIsManager } = useAuth();
  // A member only searches their own assigned tasks (managers and admins search every task).
  const scope = React.useMemo(
    () => ({ userId: authUser?.id ?? "", canSeeAll: !!authIsManager }),
    [authUser?.id, authIsManager],
  );
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [isSearching, setIsSearching] = useState(false);
  // The page number belongs to the search it was chosen for: a new query or tab is page 1 again,
  // without a second request for a page that no longer exists.
  const shapeKey = `${query.trim()}|${activeFilter}`;
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: shapeKey, page: 1 });
  const currentPage = pageState.key === shapeKey ? pageState.page : 1;
  const setCurrentPage = (v: number | ((p: number) => number)) =>
    setPageState((prev) => {
      const cur = prev.key === shapeKey ? prev.page : 1;
      return { key: shapeKey, page: typeof v === "function" ? v(cur) : v };
    });

  // Selected task for direct TaskDetailModal popup
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // The page on screen (short rows + the exact total), tab counters and matching people.
  const [pageRows, setPageRows] = useState<TaskSearchRow[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [tabCounts, setTabCounts] = useState<TabCounts>({ all: 0, in_progress: 0, pending: 0, completed: 0, in_review: 0 });
  const [members, setMembers] = useState<Profile[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const justClosedDetailRef = useRef(false);

  // Focus input on open; reset on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setSelectedTaskForModal(null);
      setPageState({ key: "|all", page: 1 });
    }
  }, [open]);

  // People and tab counters depend on the query only (not on the tab or the page).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const [counts, people] = await Promise.all([
          searchTaskCounts(scope, q),
          q ? searchMembers(q) : loadPeopleDetailedSafe(),
        ]);
        if (stale) return;
        setTabCounts(counts);
        setMembers(people);
        if (!q) setProfiles(people);
      } catch (err) {
        console.warn("Search error:", err);
      }
    }, q ? 120 : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, query, scope, reloadTick]);

  // The rows of the page on screen (nothing to read for the people tab).
  useEffect(() => {
    if (!open) return;
    if (activeFilter === "members") {
      setIsSearching(false);
      return;
    }
    let stale = false;
    setIsSearching(true);
    const q = query.trim();
    const timer = setTimeout(async () => {
      try {
        const res = await searchTaskPage({ scope, query: q, tab: activeFilter, page: currentPage, pageSize: PAGE_SIZE });
        if (stale) return;
        setPageRows(res.rows);
        setPageTotal(res.total);
        // e.g. the last row of the last page was changed elsewhere
        const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        if (res.rows.length === 0 && currentPage > pages) setCurrentPage(pages);
      } catch (err) {
        console.warn("Search error:", err);
      } finally {
        if (!stale) setIsSearching(false);
      }
    }, q ? 120 : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, activeFilter, currentPage, scope, reloadTick]);

  // Re-read after the opened task was edited from the detail view.
  const loadRecentData = () => {
    resetTaskSearch();
    setReloadTick((n) => n + 1);
  };

  // Open ChatGPT with prompt pre-filled
  const handleAskAI = (e?: React.MouseEvent, task?: TaskSearchRow) => {
    if (e) e.stopPropagation();
    let promptText = "";
    if (task) {
      promptText = `Explain step-by-step how to execute or optimize this task:
Task Code: ${task.task_code || "N/A"}
Task Title: ${task.task_name}
Project: ${task.project_name || "General"}
Client: ${task.client || "Internal"}
Status: ${task.status}
Priority: ${task.priority || "Normal"}
Remarks/Details: ${task.remarks || "No additional notes"}`;
    } else {
      const q = query.trim() || "operational task management";
      promptText = `Provide operational best practices and solution for: ${q}`;
    }

    if (navigator?.clipboard) {
      navigator.clipboard.writeText(promptText).catch(() => {});
    }

    const chatGptUrl = `https://chatgpt.com/?q=${encodeURIComponent(promptText)}`;
    window.open(chatGptUrl, "_blank");
    toast.success("Prompt Prefilled in ChatGPT");
  };

  // Direct Task Click -> Open TaskDetailModal with full card data
  // The list only holds short rows; the detail view reads the full row of the one task opened.
  const handleOpenTaskDetail = async (task: TaskSearchRow) => {
    const full = await fetchFullTask(task.id);
    if (full) setSelectedTaskForModal(full);
    else toast.error("Could not open this task");
  };

  // Tab counters come from the server (matching the current search, not narrowed by the tab)
  const inProgressCount = tabCounts.in_progress;
  const pendingCount = tabCounts.pending;
  const completedCount = tabCounts.completed;
  const inReviewCount = tabCounts.in_review;

  const showMembers = activeFilter === "all" || activeFilter === "members";

  // Pagination: the server returned this page and the exact total
  const filteredTasks = activeFilter === "members" ? [] : pageRows;
  const filteredTotal = activeFilter === "members" ? 0 : pageTotal;
  const totalPages = Math.ceil(filteredTotal / PAGE_SIZE) || 1;
  const paginatedTasks = filteredTasks;

  const getStatusDotClass = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]";
      case "In Progress":
        return "bg-[#5C8EFA] shadow-[0_0_8px_rgba(92,142,250,0.5)] animate-pulse";
      case "In Review":
        return "bg-[#5C8EFA]/80 shadow-[0_0_8px_rgba(92,142,250,0.4)]";
      case "Blocked":
      case "On Hold":
        return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
      default:
        return "bg-slate-400";
    }
  };

  const handleModalOpenChange = (newOpen: boolean) => {
    if (!newOpen && (selectedTaskForModal || justClosedDetailRef.current)) {
      // Do not close global search modal if task detail modal is open or was just closed
      return;
    }
    onOpenChange(newOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleModalOpenChange}>
        <DialogContent className="max-w-2xl p-0 gap-0 bg-[#090D16] border border-slate-800/80 shadow-2xl rounded-2xl overflow-hidden text-slate-100 z-50">
          
          <DialogTitle className="sr-only">Search and Command Center</DialogTitle>
          <DialogDescription className="sr-only">
            Search tasks, team members, or filter by status inside modal.
          </DialogDescription>

          {/* 1. TOP SEARCH INPUT BAR */}
          <div className="p-3 sm:p-3.5 border-b border-slate-800/80 flex items-center gap-2.5 relative bg-[#060810]">
            <Search className="h-4 w-4 text-[#5C8EFA] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks, codes, projects, team..."
              className="w-full bg-transparent text-slate-100 placeholder:text-slate-500 text-xs sm:text-sm font-normal focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 2. OPERON CLEAN COMPACT STATUS FILTER TABS */}
          <div className="px-3 sm:px-4 py-1.5 bg-[#070A12] border-b border-slate-800/80 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden text-[11px]">
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-all shrink-0 cursor-pointer",
                activeFilter === "all"
                  ? "bg-[#5C8EFA]/15 text-[#5C8EFA] border border-[#5C8EFA]/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              All ({tabCounts.all})
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("in_progress")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-all shrink-0 flex items-center gap-1 cursor-pointer",
                activeFilter === "in_progress"
                  ? "bg-[#5C8EFA]/15 text-[#5C8EFA] border border-[#5C8EFA]/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#5C8EFA] animate-pulse" />
              <span>In Progress ({inProgressCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("pending")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-all shrink-0 flex items-center gap-1 cursor-pointer",
                activeFilter === "pending"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <Clock className="h-3 w-3 text-amber-400" />
              <span>Pending ({pendingCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("completed")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-all shrink-0 flex items-center gap-1 cursor-pointer",
                activeFilter === "completed"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>Completed ({completedCount})</span>
            </button>

            {inReviewCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("in_review")}
                className={cn(
                  "px-2.5 py-1 rounded font-medium transition-all shrink-0 flex items-center gap-1 cursor-pointer",
                  activeFilter === "in_review"
                    ? "bg-[#5C8EFA]/15 text-[#5C8EFA] border border-[#5C8EFA]/30 font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                )}
              >
                <span>In Review ({inReviewCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveFilter("members")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-all shrink-0 flex items-center gap-1 cursor-pointer",
                activeFilter === "members"
                  ? "bg-[#5C8EFA]/15 text-[#5C8EFA] border border-[#5C8EFA]/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <Users className="h-3 w-3" />
              <span>Team ({members.length})</span>
            </button>
          </div>

          {/* 3. RESULTS CONTAINER */}
          <div className="min-h-[260px] max-h-[380px] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-3 space-y-2 bg-[#090D16]">
            
            {/* Header Result Counter */}
            <div className="flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>
                {activeFilter === "in_progress" && "In Progress Tasks"}
                {activeFilter === "pending" && "Pending / To Do Tasks"}
                {activeFilter === "completed" && "Completed Tasks"}
                {activeFilter === "in_review" && "In Review Tasks"}
                {activeFilter === "members" && "Team Members"}
                {activeFilter === "all" && (query.trim() ? `Search Results (${filteredTotal})` : `Recent Tasks (${filteredTotal})`)}
              </span>
              {filteredTotal > 0 && (
                <span className="normal-case font-normal text-slate-500">
                  Page {currentPage} of {totalPages}
                </span>
              )}
            </div>

            {/* Modern ClickUp-Style Skeleton Loader */}
            {isSearching && (
              <div className="space-y-1.5 py-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#0F1420]/60 border border-slate-800/60 animate-pulse"
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0 pr-3">
                      {/* Dot skeleton */}
                      <div className="h-2 w-2 rounded-full bg-slate-700/70 shrink-0" />

                      <div className="space-y-1.5 flex-1 min-w-0">
                        {/* Title & Badge skeleton */}
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3.5 bg-slate-800/90 rounded-md"
                            style={{ width: `${40 + (i * 12) % 35}%` }}
                          />
                          <div className="h-3 bg-slate-800/50 rounded-sm w-12" />
                        </div>
                        {/* Subtitle skeleton */}
                        <div
                          className="h-2.5 bg-slate-800/40 rounded-md"
                          style={{ width: `${25 + (i * 15) % 30}%` }}
                        />
                      </div>
                    </div>

                    {/* Action pill skeleton */}
                    <div className="h-5 w-16 bg-slate-800/70 rounded-md shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Tasks List */}
            {!isSearching && paginatedTasks.length > 0 && (
              <div className="space-y-1">
                {paginatedTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleOpenTaskDetail(t)}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#0F1420] border border-slate-800/80 hover:border-[#5C8EFA]/40 hover:bg-[#141A29] transition-all cursor-pointer group"
                  >
                    {/* Left Info */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                      <div className={cn("h-2 w-2 rounded-full shrink-0", getStatusDotClass(t.status))} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-slate-100 font-medium text-[12px] group-hover:text-white">
                            {t.task_name}
                          </span>
                          {t.task_code && (
                            <span className="text-[9px] font-mono text-slate-400 bg-slate-900/90 px-1 py-0.2 rounded border border-slate-700/60 shrink-0">
                              {t.task_code}
                            </span>
                          )}
                        </div>

                        <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5 font-normal">
                          {t.project_name && <span>in <strong className="text-slate-300 font-medium">{t.project_name}</strong></span>}
                          {t.client && <span>• {t.client}</span>}
                          <span>• Status: <span className="text-slate-300 font-medium">{t.status}</span></span>
                        </div>
                      </div>
                    </div>

                    {/* Right Hover Toolbar (Ask AI + Open Detail) */}
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => handleAskAI(e, t)}
                        className="px-2 py-0.5 rounded bg-[#5C8EFA] hover:bg-[#4A7CE8] text-[#070B14] text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                        title="Prefill AI task prompt"
                      >
                        <Sparkles className="h-2.5 w-2.5 text-[#070B14]" />
                        <span>Prefill AI</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenTaskDetail(t)}
                        className="p-1 rounded bg-[#182030] hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors cursor-pointer"
                        title="Open task details"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Team Members List */}
            {!isSearching && showMembers && members.length > 0 && (
              <div className="space-y-1 pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
                  Team Members ({members.length})
                </div>
                {members.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      onOpenChange(false);
                      navigate({ to: "/tasks", search: { assignee: m.id, tab: "all_tasks" } as any });
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#0F1420] border border-slate-800/80 hover:border-[#5C8EFA]/40 hover:bg-[#141A29] transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-[#5C8EFA]/20 text-[#5C8EFA] flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(m.display_name || m.email || "U").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-slate-100 font-medium text-[12px] group-hover:text-white">
                          {m.display_name || m.email}
                        </div>
                        {m.email && <div className="text-[10px] text-slate-400 font-normal">{m.email}</div>}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#5C8EFA] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      View Tasks ↗
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!isSearching && filteredTasks.length === 0 && (!showMembers || members.length === 0) && (
              <div className="py-12 text-center text-xs text-slate-400 bg-[#0E131F] rounded-xl border border-dashed border-slate-800/80">
                <p>No matching tasks found.</p>
              </div>
            )}
          </div>

          {/* 4. PAGINATION CONTROLS */}
          {!isSearching && filteredTotal > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-2 bg-[#060810] border-t border-slate-800/80 text-xs text-slate-400">
              <span className="font-medium">
                Showing <strong className="text-slate-200">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredTotal)}</strong> of <strong className="text-slate-200">{filteredTotal}</strong> tasks
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#141A29] border border-slate-700/60 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Prev</span>
                </button>
                <span className="px-2 font-mono text-[11px] text-slate-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#141A29] border border-slate-700/60 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* 5. MODAL FOOTER HINTS */}
          <div className="px-4 py-2 bg-[#04060C] border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Press <kbd className="font-mono bg-slate-800 text-slate-300 px-1 py-0.5 rounded border border-slate-700">Ctrl K</kbd> anytime</span>
              <span>•</span>
              <span>Hover task for actions</span>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/tasks", search: { search: query.trim(), tab: "all_tasks" } as any });
              }}
              className="text-[#5C8EFA] hover:underline font-semibold flex items-center gap-1 text-[11px]"
            >
              <span>View in Tasks page</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

        </DialogContent>
      </Dialog>

      {/* Direct Task Detail Popup Modal */}
      {selectedTaskForModal && (
        <TaskDetailModal
          task={selectedTaskForModal}
          open={!!selectedTaskForModal}
          onOpenChange={(open) => {
            if (!open) {
              justClosedDetailRef.current = true;
              setSelectedTaskForModal(null);
              setTimeout(() => {
                justClosedDetailRef.current = false;
              }, 400);
            }
          }}
          profiles={profiles}
          onTaskUpdated={loadRecentData}
        />
      )}
    </>
  );
}
