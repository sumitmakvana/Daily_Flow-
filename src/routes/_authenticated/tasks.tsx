import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { TaskCard } from "@/components/TaskCard";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Upload, Download, Calendar, ArrowUpDown, Copy, Filter, RotateCcw, List, ChevronLeft, ChevronRight, CheckCircle2, Clock, Layers, User, Users } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task } from "@/lib/types";
import { getDefaultStartDate } from "@/lib/format";
import { CSVImportDialog } from "@/components/CSVImportDialog";
import { downloadCSV, toCSV } from "@/lib/csv";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { tasksService } from "@/services/tasks";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    taskId?: string;
    highlightId?: string;
    create?: boolean;
    search?: string;
    assignee?: string;
    tab?: string;
    status?: string;
  } => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    highlightId: typeof search.highlightId === "string" ? search.highlightId : undefined,
    create: search.create === true || search.create === "true" || undefined,
    search: typeof search.search === "string" ? search.search : undefined,
    assignee: typeof search.assignee === "string" ? search.assignee : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
  }),
  component: TasksPage,
});

const ALL = "__all";

function getTaskDayLabel(isoDate: string | null | undefined): { key: string; label: string; dateObj: Date | null } {
  if (!isoDate) {
    return { key: "999_no_date", label: "No Date", dateObj: null };
  }

  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 3600 * 24));

  const dateKey = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  const formattedDate = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });

  if (diffDays === 0) {
    return { key: dateKey, label: `Today (${formattedDate})`, dateObj: target };
  }
  if (diffDays === 1) {
    return { key: dateKey, label: `Yesterday (${formattedDate})`, dateObj: target };
  }
  if (diffDays === -1) {
    return { key: dateKey, label: `Tomorrow (${formattedDate})`, dateObj: target };
  }

  return { key: dateKey, label: formattedDate, dateObj: target };
}

function groupTasksByWhatsAppDay(taskList: Task[], sortBy: string = "newest") {
  const map = new Map<string, { label: string; dateObj: Date | null; tasks: Task[] }>();

  for (const t of taskList) {
    const dateStr = t.due_date ? t.due_date : t.start_date ? t.start_date : t.created_at ? t.created_at.slice(0, 10) : null;
    const info = getTaskDayLabel(dateStr);

    if (!map.has(info.key)) {
      map.set(info.key, { label: info.label, dateObj: info.dateObj, tasks: [] });
    }
    map.get(info.key)!.tasks.push(t);
  }

  const isAscending = sortBy === "due_soon" || sortBy === "oldest";

  return Array.from(map.entries())
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => {
      if (a.key === "999_no_date") return 1;
      if (b.key === "999_no_date") return -1;
      if (!a.dateObj && !b.dateObj) return 0;
      if (!a.dateObj) return 1;
      if (!b.dateObj) return -1;
      return isAscending
        ? a.dateObj.getTime() - b.dateObj.getTime()
        : b.dateObj.getTime() - a.dateObj.getTime();
    });
}

function getPageNumbers(current: number, total: number): Array<number | "..."> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, "...", total];
  }
  if (current >= total - 2) {
    return [1, "...", total - 3, total - 2, total - 1, total];
  }
  return [1, "...", current - 1, current, current + 1, "...", total];
}

function TasksPage() {
  const { user, isManager } = useAuth();
  const { taskId, highlightId, create, search: searchParam, assignee: assigneeParam, tab: tabParam, status: statusParam } = Route.useSearch();
  const navigate = useNavigate({ from: "/tasks" });

  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [q, setQ] = useState(searchParam || "");
  const [initialLoading, setInitialLoading] = useState(true);

  // Multi-select Checkbox Filter States
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(statusParam && statusParam !== ALL ? [statusParam] : []));
  const [selectedPriorities, setSelectedPriorities] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState<string>(assigneeParam || ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedDetailTask, setSelectedDetailTask] = useState<Task | null>(null);

  // Pagination states
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("1");

  // Date Filter state
  const [dateFilter, setDateFilter] = useState<string>(ALL);
  const [sortBy, setSortBy] = useState<string>("newest");

  // Tab state
  const [activeTab, setActiveTab] = useState<string>(
    tabParam === "all" || tabParam === "all_tasks" || assigneeParam || searchParam || taskId
      ? "all_tasks"
      : tabParam === "team" || tabParam === "team_tasks"
        ? "team_tasks"
        : "my_tasks",
  );

  useEffect(() => {
    if (statusParam !== undefined && statusParam !== ALL) {
      setSelectedStatuses(new Set([statusParam]));
      setActiveTab("all_tasks");
    }
  }, [statusParam]);

  useEffect(() => {
    if (searchParam !== undefined) {
      setQ(searchParam);
      if (searchParam.trim()) {
        setActiveTab("all_tasks");
      }
    }
  }, [searchParam]);

  useEffect(() => {
    if (assigneeParam !== undefined) {
      setAssignee(assigneeParam || ALL);
      if (assigneeParam && assigneeParam !== ALL) {
        setActiveTab("all_tasks");
      }
    }
  }, [assigneeParam]);

  useEffect(() => {
    if (tabParam === "all" || tabParam === "all_tasks") {
      setActiveTab("all_tasks");
    } else if (tabParam === "team" || tabParam === "team_tasks") {
      setActiveTab("team_tasks");
    } else if (tabParam === "my" || tabParam === "my_tasks") {
      setActiveTab("my_tasks");
    }
  }, [tabParam]);

  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  const nameOf = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.display_name ?? "" : "");

  const activeFilterCount = [
    q ? 1 : 0,
    selectedStatuses.size > 0 ? 1 : 0,
    selectedPriorities.size > 0 ? 1 : 0,
    assignee !== ALL ? 1 : 0,
    dateFilter !== ALL ? 1 : 0,
    sortBy !== "newest" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const handleClearAllFilters = () => {
    setQ("");
    setSelectedStatuses(new Set());
    setSelectedPriorities(new Set());
    setAssignee(ALL);
    setDateFilter(ALL);
    setSortBy("newest");
    toast.info("All filters reset");
  };

  const exportCSV = () => {
    const rows = sorted.map((t) => ({
      task_code: t.task_code,
      task_name: t.task_name,
      client: t.client ?? "",
      project_name: t.project_name ?? "",
      priority: t.priority,
      status: t.status,
      assigned_to: nameOf(t.assigned_to),
      reviewer: nameOf(t.reviewer),
      start_date: t.start_date ?? "",
      due_date: t.due_date ?? "",
      planned_hours: t.planned_hours ?? "",
      actual_hours: t.actual_hours ?? "",
      remarks: t.remarks ?? "",
    }));
    const cols = ["task_code","task_name","client","project_name","priority","status","assigned_to","reviewer","start_date","due_date","planned_hours","actual_hours","remarks"];
    downloadCSV(`tasks-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
  };

  const load = async (silent = false) => {
    try {
      if (!silent && tasks.length === 0) {
        setInitialLoading(true);
      }
      const [{ data: t }, { data: p }, { data: e }, { data: w }] = await Promise.all([
        supabase.from("tasks").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id,display_name,avatar_url"),
        supabase.from("profile_emails" as never).select("id,email") as never,
        supabase.from("task_worklogs").select("*").order("work_date", { ascending: false }),
      ]);

      const worklogsByTask = new Map<string, any[]>();
      const todayStr = new Date().toISOString().slice(0, 10);
      for (const item of w || []) {
        const list = worklogsByTask.get(item.task_id) || [];
        list.push(item);
        worklogsByTask.set(item.task_id, list);
      }

      const enrichedTasks = ((t ?? []) as Task[]).map((task) => {
        const logs = worklogsByTask.get(task.id) || [];
        const todayLogs = logs.filter((x) => x.work_date === todayStr);
        const todaySys = todayLogs.reduce((sum, x) => sum + Number(x.system_hours || 0), 0);
        return {
          ...task,
          today_system_hours: todaySys,
          worklogs: logs,
        };
      });

      setTasks(enrichedTasks);
      setProfiles((p ?? []) as Profile[]);
      const map: Record<string, string> = {};
      for (const row of ((e ?? []) as Array<{ id: string; email: string }>)) map[row.id] = row.email;
      setEmails(map);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => { load(false); }, []);
  useRealtimeTasks(() => load(true), "tasks-page-rt");

  // Active tab base tasks before status/priority filters are applied
  const tabBaseTasks = useMemo(() => {
    if (activeTab === "my_tasks") {
      return tasks.filter((t) => t.assigned_to === user?.id);
    }
    if (activeTab === "team_tasks") {
      return tasks.filter((t) => t.assigned_to !== user?.id);
    }
    return tasks;
  }, [tasks, activeTab, user?.id]);

  // Calculate live count metrics for sidebar filters scoped to current tab
  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of TASK_STATUSES) map[s] = 0;
    for (const t of tabBaseTasks) {
      if (t.status && map[t.status] !== undefined) map[t.status]++;
    }
    return map;
  }, [tabBaseTasks]);

  const priorityCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of TASK_PRIORITIES) map[p] = 0;
    for (const t of tabBaseTasks) {
      if (t.priority && map[t.priority] !== undefined) map[t.priority]++;
    }
    return map;
  }, [tabBaseTasks]);

  // Auto-open TaskDetailModal when taskId or highlightId query parameter is present
  useEffect(() => {
    const targetId = taskId || highlightId;
    if (!targetId || tasks.length === 0) return;

    const matchedTask = tasks.find((t) => t.id === targetId);
    if (matchedTask) {
      setSelectedDetailTask(matchedTask);
    }
  }, [taskId, highlightId, tasks]);

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedTaskIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete the ${selectedTaskIds.size} selected tasks?`)) return;
    try {
      const ids = Array.from(selectedTaskIds);
      await Promise.all(ids.map((id) => tasksService.delete(id)));
      toast.success(`Successfully deleted ${ids.length} tasks`);
      setSelectedTaskIds(new Set());
      load(true);
    } catch (err) {
      toast.error("Failed to delete tasks: " + (err as Error).message);
    }
  };

  const handleBulkComplete = async () => {
    try {
      const tasksToUpdate = tasks.filter((t) => selectedTaskIds.has(t.id));
      await Promise.all(tasksToUpdate.map((t) => tasksService.setStatus(t, "Completed", user?.id || "")));
      toast.success(`Successfully completed ${tasksToUpdate.length} tasks`);
      setSelectedTaskIds(new Set());
      load(true);
    } catch (err) {
      toast.error("Failed to update tasks: " + (err as Error).message);
    }
  };

  const handleBulkReassign = async (newAssigneeId: string) => {
    if (!newAssigneeId) return;
    try {
      const tasksToUpdate = tasks.filter((t) => selectedTaskIds.has(t.id));
      await Promise.all(
        tasksToUpdate.map((t) =>
          tasksService.update(t, { assigned_to: newAssigneeId === "unassigned" ? null : newAssigneeId }, user?.id || "")
        )
      );
      toast.success(`Successfully reassigned ${tasksToUpdate.length} tasks`);
      setSelectedTaskIds(new Set());
      load(true);
    } catch (err) {
      toast.error("Failed to reassign tasks: " + (err as Error).message);
    }
  };

  const handleBulkUpdateProject = async () => {
    const defaultVal = tasks.find(t => selectedTaskIds.has(t.id))?.project_name ?? "";
    const newProject = prompt("Enter new project name for selected tasks:", defaultVal);
    if (newProject === null) return;
    
    try {
      const tasksToUpdate = tasks.filter((t) => selectedTaskIds.has(t.id));
      await Promise.all(
        tasksToUpdate.map((t) =>
          tasksService.update(t, { project_name: newProject.trim() || null }, user?.id || "")
        )
      );
      toast.success(`Successfully updated project for ${tasksToUpdate.length} tasks`);
      setSelectedTaskIds(new Set());
      load(true);
    } catch (err) {
      toast.error("Failed to update project: " + (err as Error).message);
    }
  };

  const handleBulkDuplicate = async () => {
    try {
      const tasksToDuplicate = tasks.filter((t) => selectedTaskIds.has(t.id));
      if (tasksToDuplicate.length === 0) return;
      const defaultStartDate = getDefaultStartDate();
      await Promise.all(
        tasksToDuplicate.map((t) =>
          tasksService.create(
            {
              task_name: `${t.task_name} (Copy)`,
              assigned_to: t.assigned_to,
              type_id: t.type_id,
              client: t.client,
              project_name: t.project_name,
              project_id: t.project_id,
              priority: t.priority,
              status: "To Do",
              start_date: defaultStartDate,
              due_date: t.due_date,
              planned_hours: t.planned_hours !== undefined && t.planned_hours !== null ? t.planned_hours : 4,
              actual_hours: 0,
              system_hours: 0,
              started_at: null,
              remarks: t.remarks,
              custom_fields: t.custom_fields || {},
            },
            user?.id || ""
          )
        )
      );
      toast.success(`Successfully duplicated ${tasksToDuplicate.length} tasks`);
      setSelectedTaskIds(new Set());
      load(true);
    } catch (err) {
      toast.error("Failed to duplicate tasks: " + (err as Error).message);
    }
  };

  // Base filtered list with multi-select status/priority & date filters
  const filtered = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    
    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    
    const startOfWeek = new Date();
    startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    const startOfWeekStr = startOfWeek.toISOString().slice(0, 10);
    const endOfWeek = new Date();
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);

    return tasks.filter((t) => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(t.status)) return false;
      if (selectedPriorities.size > 0 && !selectedPriorities.has(t.priority)) return false;
      if (assignee !== ALL && t.assigned_to !== assignee) return false;
      if (q) {
        const assigneeName = nameOf(t.assigned_to);
        const assigneeEmail = t.assigned_to ? emails[t.assigned_to] ?? "" : "";
        const reviewerName = nameOf(t.reviewer);
        const combinedText = `${t.task_code || ""} ${t.task_name || ""} ${t.client || ""} ${t.project_name || ""} ${t.remarks || ""} ${t.status || ""} ${t.priority || ""} ${assigneeName} ${assigneeEmail} ${reviewerName}`.toLowerCase();
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        if (!tokens.every((token) => combinedText.includes(token))) return false;
      }
      
      const targetDt = t.due_date || t.start_date;
      if (dateFilter === "today" && targetDt !== todayStr) return false;
      if (dateFilter === "tomorrow" && targetDt !== tomorrowStr) return false;
      if (dateFilter === "this_week") {
        if (!targetDt || targetDt < startOfWeekStr || targetDt > endOfWeekStr) return false;
      }
      if (dateFilter === "overdue") {
        if (!targetDt || targetDt >= todayStr || t.status === "Completed") return false;
      }
      if (dateFilter === "no_due_date" && targetDt) return false;

      return true;
    });
  }, [tasks, q, selectedStatuses, selectedPriorities, assignee, dateFilter]);

  // Sort tasks
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortBy === "oldest") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortBy === "due_soon") {
        const dtA = a.due_date || a.start_date;
        const dtB = b.due_date || b.start_date;
        if (!dtA) return 1;
        if (!dtB) return -1;
        return new Date(dtA).getTime() - new Date(dtB).getTime();
      }
      if (sortBy === "due_late") {
        const dtA = a.due_date || a.start_date;
        const dtB = b.due_date || b.start_date;
        if (!dtA) return 1;
        if (!dtB) return -1;
        return new Date(dtB).getTime() - new Date(dtA).getTime();
      }
      return 0;
    });
  }, [filtered, sortBy]);

  // Split into two sections: my tasks vs team tasks
  const myTasks = useMemo(
    () => sorted.filter((t) => t.assigned_to === user?.id),
    [sorted, user?.id]
  );
  const teamTasks = useMemo(
    () => sorted.filter((t) => t.assigned_to !== user?.id),
    [sorted, user?.id]
  );

  const currentTabTasks = useMemo(() => {
    if (activeTab === "my_tasks") return myTasks;
    if (activeTab === "team_tasks") return teamTasks;
    return sorted;
  }, [activeTab, myTasks, teamTasks, sorted]);

  // Reset pagination page to 1 when filters or tabs change
  useEffect(() => {
    setCurrentPage(1);
    setPageInput("1");
  }, [q, selectedStatuses, selectedPriorities, assignee, dateFilter, activeTab, pageSize, sortBy]);

  // Compute pagination parameters
  const totalItems = currentTabTasks.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validatedPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedTasks = useMemo(() => {
    const start = (validatedPage - 1) * pageSize;
    return currentTabTasks.slice(start, start + pageSize);
  }, [currentTabTasks, validatedPage, pageSize]);

  // Switch tab automatically if we have a highlightId from My Day/Notification
  useEffect(() => {
    if (!highlightId || tasks.length === 0) return;
    const targetTask = tasks.find((t) => t.id === highlightId);
    if (targetTask) {
      if (targetTask.assigned_to === user?.id) {
        setActiveTab("my_tasks");
      } else {
        setActiveTab("team_tasks");
      }
    }
  }, [highlightId, tasks, user?.id]);

  // Scroll + highlight task when coming from a notification click
  useEffect(() => {
    if (!highlightId || filtered.length === 0) return;
    const el = document.getElementById(`task-card-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveHighlight(highlightId);
      const t = setTimeout(() => {
        setActiveHighlight(null);
        navigate({ search: {} as never, replace: true });
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [highlightId, filtered, navigate, activeTab]);

  // Open the create dialog if query parameter `create` is true
  useEffect(() => {
    if (create) {
      setDialogOpen(true);
      navigate({
        search: (prev) => {
          const { create: _, ...rest } = prev;
          return rest;
        },
        replace: true,
      });
    }
  }, [create, navigate]);

  if (!user) return null;

  const renderTaskCard = (t: Task) => (
    <div
      key={t.id}
      id={`task-card-${t.id}`}
      className={[
        "rounded-lg transition-all duration-300",
        activeHighlight === t.id
          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
          : "",
      ].join(" ")}
    >
      <TaskCard
        task={t}
        assignee={profiles.find((p) => p.id === t.assigned_to)}
        profiles={profiles}
        userId={user.id}
        canManage={isManager}
        onChanged={() => load(true)}
        selected={selectedTaskIds.has(t.id)}
        onSelectToggle={() => handleToggleSelect(t.id)}
      />
    </div>
  );

  const renderWhatsAppGroupedTasks = (taskList: Task[]) => {
    const groups = groupTasksByWhatsAppDay(taskList, sortBy);
    if (groups.length === 0) return null;

    return (
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.key} className="space-y-3">
            <div className="flex items-center gap-3 my-3 select-none">
              <div className="h-[1px] flex-1 bg-border/60" />
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/90 text-foreground text-xs font-semibold shadow-2xs border border-border/70">
                <Calendar className="h-3.5 w-3.5 text-[#5C8EFA] shrink-0" />
                <span>{group.label}</span>
                <span className="text-[10px] text-[#0A0F1D] font-bold px-1.5 py-0.2 rounded-full bg-[#5C8EFA]">
                  {group.tasks.length}
                </span>
              </div>
              <div className="h-[1px] flex-1 bg-border/60" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {group.tasks.map(renderTaskCard)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render skeleton rows for fast initial loading UX
  const renderSkeletons = () => (
    <div className="space-y-3 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border border-slate-800/80 bg-[#121624] p-4 space-y-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded bg-slate-800" />
              <Skeleton className="h-4 w-40 sm:w-60 rounded bg-slate-800" />
              <Skeleton className="h-5 w-16 rounded bg-slate-800" />
              <Skeleton className="h-5 w-16 rounded bg-slate-800" />
            </div>
            <Skeleton className="h-5 w-24 rounded bg-slate-800" />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full bg-slate-800" />
              <Skeleton className="h-3 w-28 rounded bg-slate-800" />
            </div>
            <Skeleton className="h-3 w-20 rounded bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );

  const overdueCount = tasks.filter((t) => {
    const today = new Date().toISOString().slice(0, 10);
    const dt = t.due_date || t.start_date;
    return dt && dt < today && t.status !== "Completed";
  }).length;

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 py-4 text-slate-100 flex flex-col h-[calc(100vh-105px)] overflow-hidden w-full">
      
      {/* Top Main Title & Subtitle + Top Right KPI Metric Summary Cards */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 select-none shrink-0 mb-3">
        
        {/* Left Title & Subtitle matching screenshot */}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">Tasks</h1>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#1e2d4a] text-[#5C8EFA] border border-[#2b3e66]">
              {tasks.length}
            </span>
          </div>
          <p className="text-xs text-[#8a99ad] mt-1 font-medium">Plan, track and get things done</p>
        </div>

        {/* Top Right KPI Metric Summary Cards matching screenshot */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
          <div className="bg-[#181a20] border border-[#262936] rounded-xl px-3.5 py-2.5 flex items-center gap-3 min-w-[130px]">
            <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
              <Layers className="h-4 w-4 text-[#5C8EFA]" />
            </div>
            <div>
              <p className="text-base font-bold text-white leading-none">{tasks.length}</p>
              <p className="text-[11px] text-[#8a99ad] mt-1 font-medium">Total Tasks</p>
            </div>
          </div>

          <div className="bg-[#181a20] border border-[#262936] rounded-xl px-3.5 py-2.5 flex items-center gap-3 min-w-[130px]">
            <div className="h-8 w-8 rounded-lg bg-[#5C8EFA]/15 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-[#5C8EFA]" />
            </div>
            <div>
              <p className="text-base font-bold text-white leading-none">
                {tasks.filter((t) => t.assigned_to === user.id).length}
              </p>
              <p className="text-[11px] text-[#8a99ad] mt-1 font-medium">My Tasks</p>
            </div>
          </div>

          <div className="bg-[#181a20] border border-[#262936] rounded-xl px-3.5 py-2.5 flex items-center gap-3 min-w-[130px]">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-base font-bold text-white leading-none">
                {tasks.filter((t) => t.assigned_to !== user.id).length}
              </p>
              <p className="text-[11px] text-[#8a99ad] mt-1 font-medium">Team Tasks</p>
            </div>
          </div>

          <div className="bg-[#181a20] border border-[#262936] rounded-xl px-3.5 py-2.5 flex items-center gap-3 min-w-[130px]">
            <div className="h-8 w-8 rounded-lg bg-rose-500/15 flex items-center justify-center shrink-0">
              <Clock className="h-4 w-4 text-rose-400" />
            </div>
            <div>
              <p className="text-base font-bold text-rose-400 leading-none">{overdueCount}</p>
              <p className="text-[11px] text-[#8a99ad] mt-1 font-medium">Overdue</p>
            </div>
          </div>
        </div>

      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        
        {/* Header Navigation Bar with Tabs & Header Actions */}
        <div className="bg-[#181a20] border border-[#262936] p-2.5 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 mb-3">
          
          {/* Tabs: My Tasks (82), Team Tasks (653), All Tasks (735) matching screenshot */}
          <TabsList className="bg-transparent border-none flex overflow-x-auto justify-start scrollbar-none gap-2 h-auto p-0">
            <TabsTrigger
              value="my_tasks"
              className="text-xs px-3.5 py-1.5 rounded-lg font-medium transition-all text-[#8a99ad] hover:text-white data-[state=active]:bg-[#252834] data-[state=active]:text-[#5C8EFA] data-[state=active]:border data-[state=active]:border-[#35394b] data-[state=active]:font-bold cursor-pointer"
            >
              My Tasks ({myTasks.length})
            </TabsTrigger>
            <TabsTrigger
              value="team_tasks"
              className="text-xs px-3.5 py-1.5 rounded-lg font-medium transition-all text-[#8a99ad] hover:text-white data-[state=active]:bg-[#252834] data-[state=active]:text-[#5C8EFA] data-[state=active]:border data-[state=active]:border-[#35394b] data-[state=active]:font-bold cursor-pointer"
            >
              Team Tasks ({teamTasks.length})
            </TabsTrigger>
            <TabsTrigger
              value="all_tasks"
              className="text-xs px-3.5 py-1.5 rounded-lg font-medium transition-all text-[#8a99ad] hover:text-white data-[state=active]:bg-[#252834] data-[state=active]:text-[#5C8EFA] data-[state=active]:border data-[state=active]:border-[#35394b] data-[state=active]:font-bold cursor-pointer"
            >
              All Tasks ({sorted.length})
            </TabsTrigger>
          </TabsList>

          {/* Right Header Actions: Import, Export, + New task matching screenshot */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button size="sm" variant="outline" className="h-8 text-xs border-[#262936] bg-[#111319] hover:bg-[#222530] text-slate-200 cursor-pointer" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1.5 text-[#5C8EFA]" /> Import
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs border-[#262936] bg-[#111319] hover:bg-[#222530] text-slate-200 cursor-pointer" onClick={exportCSV}>
              <Download className="h-3.5 w-3.5 mr-1.5 text-[#5C8EFA]" /> Export
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs border-[#35394b] bg-[#252834] hover:bg-[#2f3342] text-[#5C8EFA] font-bold px-3 cursor-pointer" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1 text-[#5C8EFA]" /> New task
            </Button>
          </div>
        </div>

        {/* 2-Column Layout: Left Sidebar Filters + Right Task List */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-5 items-stretch overflow-hidden">
          
          {/* LEFT SIDEBAR FILTER PANEL matching screenshot */}
          <aside className="w-full lg:w-64 shrink-0 bg-[#181a20] border border-[#262936] rounded-xl p-4 space-y-4 overflow-y-auto custom-scrollbar h-auto lg:h-full max-h-[280px] lg:max-h-none">
            
            {/* Header: Filters + Reset link matching screenshot */}
            <div className="flex items-center justify-between border-b border-[#262936] pb-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[#5C8EFA]" />
                <span className="font-bold text-sm text-white">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="text-[10px] font-bold bg-[#252834] text-[#5C8EFA] border border-[#35394b] px-1.5 py-0.2 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="text-xs font-semibold text-[#5C8EFA] hover:underline cursor-pointer"
              >
                Reset
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Search Box matching screenshot */}
              <div className="space-y-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8a99ad]" />
                  <Input
                    className="pl-8 h-8 text-xs bg-[#111319] border-[#262936] text-white placeholder:text-[#8a99ad] focus:border-[#5C8EFA]"
                    placeholder="Search tasks..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>

              {/* Status Checkbox Filter matching screenshot */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-semibold text-[#8a99ad] uppercase tracking-wider block mb-1">Status</span>
                {TASK_STATUSES.map((s) => {
                  const checked = selectedStatuses.has(s);
                  return (
                    <label key={s} className="flex items-center justify-between text-xs text-slate-300 hover:text-white cursor-pointer py-0.5 select-none">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedStatuses((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s);
                              else next.delete(s);
                              return next;
                            });
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-[#5C8EFA] accent-[#5C8EFA] cursor-pointer"
                        />
                        <span>{s}</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#8a99ad]">{statusCounts[s] || 0}</span>
                    </label>
                  );
                })}
              </div>

              {/* Priority Checkbox Filter matching screenshot */}
              <div className="space-y-1.5 pt-2 border-t border-[#262936]">
                <span className="text-[11px] font-semibold text-[#8a99ad] uppercase tracking-wider block mb-1">Priority</span>
                {TASK_PRIORITIES.map((p) => {
                  const checked = selectedPriorities.has(p);
                  return (
                    <label key={p} className="flex items-center justify-between text-xs text-slate-300 hover:text-white cursor-pointer py-0.5 select-none">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedPriorities((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(p);
                              else next.delete(p);
                              return next;
                            });
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-[#5C8EFA] accent-[#5C8EFA] cursor-pointer"
                        />
                        <span>{p}</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#8a99ad]">{priorityCounts[p] || 0}</span>
                    </label>
                  );
                })}
              </div>

              {/* Assignee Filter matching screenshot */}
              <div className="space-y-1 pt-2 border-t border-[#262936]">
                <span className="text-[11px] font-semibold text-[#8a99ad] uppercase tracking-wider block">Assignee</span>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger className="h-8 w-full text-xs bg-[#111319] border-[#262936] text-slate-200">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-[#8a99ad]" />
                      <SelectValue placeholder="Assignee" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181a20] border-[#262936] text-slate-200">
                    <SelectItem value={ALL}>All Assignees</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Due Date Filter matching screenshot */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-[#8a99ad] uppercase tracking-wider block">Due Date</span>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="h-8 w-full text-xs bg-[#111319] border-[#262936] text-slate-200">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-[#5C8EFA]" />
                      <SelectValue placeholder="Date" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181a20] border-[#262936] text-slate-200">
                    <SelectItem value={ALL}>All Dates</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="tomorrow">Tomorrow</SelectItem>
                    <SelectItem value="this_week">This Week</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="no_due_date">No Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort By Filter matching screenshot */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-[#8a99ad] uppercase tracking-wider block">Sort By</span>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-8 w-full text-xs bg-[#111319] border-[#262936] text-slate-200">
                    <div className="flex items-center gap-1.5">
                      <ArrowUpDown className="h-3.5 w-3.5 text-[#5C8EFA]" />
                      <SelectValue placeholder="Sort By" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181a20] border-[#262936] text-slate-200">
                    <SelectItem value="newest">Newest Created</SelectItem>
                    <SelectItem value="oldest">Oldest Created</SelectItem>
                    <SelectItem value="due_soon">Date (Soonest)</SelectItem>
                    <SelectItem value="due_late">Date (Latest)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </aside>

          {/* RIGHT MAIN PANEL: Task List + Page Size Header + Bottom Pagination matching screenshot */}
          <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-transparent">
            
            {/* List Header Toolbar matching screenshot */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 shrink-0 pb-2">
              <div className="text-xs text-[#8a99ad] font-medium">
                Showing {totalItems === 0 ? 0 : (validatedPage - 1) * pageSize + 1}–{Math.min(validatedPage * pageSize, totalItems)} of {totalItems} tasks
              </div>

              <div className="flex items-center gap-2">
                {/* List View Indicator Pill */}
                <div className="inline-flex items-center bg-[#111319] p-0.5 rounded-lg border border-[#262936]">
                  <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md bg-[#252834] text-[#5C8EFA] border border-[#35394b]">
                    <List className="h-3.5 w-3.5" /> List
                  </span>
                </div>

                {/* Items Per Page Selector matching screenshot */}
                <Select value={String(pageSize)} onValueChange={(val) => setPageSize(Number(val))}>
                  <SelectTrigger className="h-8 text-xs bg-[#181a20] border-[#262936] text-slate-200 w-[120px]">
                    <SelectValue placeholder="Per page" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#181a20] border-[#262936] text-slate-200">
                    <SelectItem value="25">25 per page</SelectItem>
                    <SelectItem value="50">50 per page</SelectItem>
                    <SelectItem value="100">100 per page</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Task List Content - ONLY THIS AREA SCROLLS */}
            <TabsContent value="my_tasks" className="flex-1 min-h-0 overflow-y-auto pr-1.5 custom-scrollbar space-y-3 mt-0 focus-visible:outline-none">
              {initialLoading ? (
                renderSkeletons()
              ) : paginatedTasks.length > 0 ? (
                renderWhatsAppGroupedTasks(paginatedTasks)
              ) : (
                <p className="text-sm text-[#8a99ad] italic py-12 text-center bg-[#181a20]/60 rounded-xl border border-dashed border-[#262936]">
                  No tasks assigned to you.
                </p>
              )}
            </TabsContent>

            <TabsContent value="team_tasks" className="flex-1 min-h-0 overflow-y-auto pr-1.5 custom-scrollbar space-y-3 mt-0 focus-visible:outline-none">
              {initialLoading ? (
                renderSkeletons()
              ) : paginatedTasks.length > 0 ? (
                renderWhatsAppGroupedTasks(paginatedTasks)
              ) : (
                <p className="text-sm text-[#8a99ad] italic py-12 text-center bg-[#181a20]/60 rounded-xl border border-dashed border-[#262936]">
                  No team tasks found.
                </p>
              )}
            </TabsContent>

            <TabsContent value="all_tasks" className="flex-1 min-h-0 overflow-y-auto pr-1.5 custom-scrollbar space-y-3 mt-0 focus-visible:outline-none">
              {initialLoading ? (
                renderSkeletons()
              ) : paginatedTasks.length > 0 ? (
                renderWhatsAppGroupedTasks(paginatedTasks)
              ) : (
                <p className="text-sm text-[#8a99ad] italic py-12 text-center bg-[#181a20]/60 rounded-xl border border-dashed border-[#262936]">
                  No tasks match the filters.
                </p>
              )}
            </TabsContent>

            {/* BOTTOM PAGINATION CONTROLS FOOTER matching screenshot - STICKY AT BOTTOM */}
            {!initialLoading && totalPages > 1 && (
              <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 mt-2 border-t border-[#262936] bg-[#181a20]/95 backdrop-blur z-10 select-none text-xs">
                <div className="text-[#8a99ad] font-medium">
                  Showing {(validatedPage - 1) * pageSize + 1}–{Math.min(validatedPage * pageSize, totalItems)} of {totalItems} tasks
                </div>

                {/* Page Number Buttons matching screenshot */}
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={validatedPage <= 1}
                    onClick={() => {
                      const p = validatedPage - 1;
                      setCurrentPage(p);
                      setPageInput(String(p));
                    }}
                    className="h-8 w-8 p-0 border-[#262936] bg-[#111319] text-slate-300 hover:bg-[#222530] cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {getPageNumbers(validatedPage, totalPages).map((p, idx) =>
                    p === "..." ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-[#8a99ad]">...</span>
                    ) : (
                      <Button
                        key={`page-${p}`}
                        size="sm"
                        variant={validatedPage === p ? "default" : "outline"}
                        onClick={() => {
                          setCurrentPage(Number(p));
                          setPageInput(String(p));
                        }}
                        className={cn(
                          "h-8 min-w-[32px] px-2 text-xs font-semibold cursor-pointer border-[#262936]",
                          validatedPage === p
                            ? "bg-[#252834] text-[#5C8EFA] hover:bg-[#2f3342] border-[#35394b] font-bold"
                            : "bg-[#111319] text-slate-300 hover:bg-[#222530]"
                        )}
                      >
                        {p}
                      </Button>
                    )
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={validatedPage >= totalPages}
                    onClick={() => {
                      const p = validatedPage + 1;
                      setCurrentPage(p);
                      setPageInput(String(p));
                    }}
                    className="h-8 w-8 p-0 border-[#262936] bg-[#111319] text-slate-300 hover:bg-[#222530] cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                {/* Go To Page Input matching screenshot */}
                <div className="flex items-center gap-2 text-[#8a99ad]">
                  <span>Go to page</span>
                  <Input
                    className="h-8 w-14 text-xs text-center bg-[#111319] border-[#262936] text-white font-mono"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const num = parseInt(pageInput, 10);
                        if (!isNaN(num) && num >= 1 && num <= totalPages) {
                          setCurrentPage(num);
                        } else {
                          setPageInput(String(validatedPage));
                        }
                      }
                    }}
                    onBlur={() => {
                      const num = parseInt(pageInput, 10);
                      if (!isNaN(num) && num >= 1 && num <= totalPages) {
                        setCurrentPage(num);
                      } else {
                        setPageInput(String(validatedPage));
                      }
                    }}
                  />
                  <span>of {totalPages}</span>
                </div>
              </div>
            )}
          </div>

        </div>
      </Tabs>

      {/* Bulk action sticky floating bar */}
      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#0B1220] text-slate-100 border border-slate-700/80 shadow-2xl rounded-xl sm:rounded-full px-4 py-2.5 sm:px-5 sm:py-3 flex flex-col sm:flex-row items-center gap-2 sm:gap-4 max-w-[92vw] w-max select-none animate-in fade-in slide-in-from-bottom-4 duration-300">
          <span className="text-xs font-medium shrink-0">
            {selectedTaskIds.size} {selectedTaskIds.size === 1 ? "task" : "tasks"} selected
          </span>
          <div className="flex flex-wrap items-center gap-1.5 border-t sm:border-t-0 sm:border-l border-slate-800 pt-2 sm:pt-0 sm:pl-4 w-full sm:w-auto justify-center">
            <Select onValueChange={handleBulkReassign}>
              <SelectTrigger className="h-7 text-[10px] sm:text-xs px-2.5 rounded-full border border-slate-700 bg-[#070B14] w-28 sm:w-32 cursor-pointer shadow-none text-slate-200">
                <SelectValue placeholder="Reassign..." />
              </SelectTrigger>
              <SelectContent className="bg-[#0B1220] border-slate-800 text-slate-200">
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] sm:text-xs px-2.5 rounded-full cursor-pointer hover:bg-slate-800 bg-[#070B14] border-slate-700 text-slate-200"
              onClick={handleBulkUpdateProject}
            >
              Set Project
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] sm:text-xs px-2.5 rounded-full cursor-pointer hover:bg-slate-800 bg-[#070B14] border-slate-700 text-slate-200 gap-1"
              onClick={handleBulkDuplicate}
              title="Duplicate selected tasks"
            >
              <Copy className="h-3 w-3" /> Duplicate
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] sm:text-xs px-2.5 rounded-full cursor-pointer text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              onClick={handleBulkComplete}
            >
              Mark Completed
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-[10px] sm:text-xs px-2.5 rounded-full cursor-pointer"
              onClick={handleBulkDelete}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] sm:text-xs px-2.5 rounded-full text-slate-400 hover:text-white cursor-pointer hover:bg-slate-800"
              onClick={handleClearSelection}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <TaskFormDialog open={dialogOpen} onOpenChange={setDialogOpen} userId={user.id} onSaved={() => load(true)} />
      <CSVImportDialog open={importOpen} onOpenChange={setImportOpen} profiles={profiles} userId={user.id} isManager={isManager} onDone={() => load(true)} />
      
      {/* Search & Direct Navigation Task Detail Modal */}
      {selectedDetailTask && (
        <TaskDetailModal
          task={selectedDetailTask}
          open={!!selectedDetailTask}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedDetailTask(null);
            }
          }}
          profiles={profiles}
          userId={user.id}
          canManage={isManager}
          onChanged={() => load(true)}
        />
      )}
    </div>
  );
}
