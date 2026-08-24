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
import { Plus, Search, Upload, Download, Trash2, Calendar, ArrowUpDown, Copy, Filter, RotateCcw } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task } from "@/lib/types";
import { getDefaultStartDate } from "@/lib/format";
import { CSVImportDialog } from "@/components/CSVImportDialog";
import { downloadCSV, toCSV } from "@/lib/csv";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { tasksService } from "@/services/tasks";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    highlightId?: string;
    create?: boolean;
    search?: string;
    assignee?: string;
    tab?: string;
  } => ({
    highlightId: typeof search.highlightId === "string" ? search.highlightId : undefined,
    create: search.create === true || search.create === "true" || undefined,
    search: typeof search.search === "string" ? search.search : undefined,
    assignee: typeof search.assignee === "string" ? search.assignee : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: TasksPage,
});

const ALL = "__all";

function getTaskDayLabel(isoDate: string | null | undefined): { key: string; label: string; dateObj: Date | null } {
  if (!isoDate) {
    return { key: "999_no_date", label: "No Due Date", dateObj: null };
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
    const dateStr = t.due_date ? t.due_date : t.created_at ? t.created_at.slice(0, 10) : null;
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

function TasksPage() {
  const { user, isManager } = useAuth();
  const { highlightId, create, search: searchParam, assignee: assigneeParam, tab: tabParam } = Route.useSearch();
  const navigate = useNavigate({ from: "/tasks" });

  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [q, setQ] = useState(searchParam || "");

  const [status, setStatus] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [assignee, setAssignee] = useState<string>(assigneeParam || ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // New UI feature states
  const [activeTab, setActiveTab] = useState<string>(
    tabParam === "all" || tabParam === "all_tasks" || assigneeParam || searchParam
      ? "all_tasks"
      : tabParam === "team" || tabParam === "team_tasks"
        ? "team_tasks"
        : "my_tasks",
  );

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
  const [dateFilter, setDateFilter] = useState<string>(ALL);
  const [sortBy, setSortBy] = useState<string>("newest");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [confirmDeleteAllText, setConfirmDeleteAllText] = useState("");

  // Highlight state — React state (not classList) so Tailwind v4 includes the classes
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  const nameOf = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.display_name ?? "" : "");

  const activeFilterCount = [
    q ? 1 : 0,
    status !== ALL ? 1 : 0,
    priority !== ALL ? 1 : 0,
    assignee !== ALL ? 1 : 0,
    dateFilter !== ALL ? 1 : 0,
    sortBy !== "newest" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const handleClearAllFilters = () => {
    setQ("");
    setStatus(ALL);
    setPriority(ALL);
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
      due_date: t.due_date ?? "",
      planned_hours: t.planned_hours ?? "",
      actual_hours: t.actual_hours ?? "",
      remarks: t.remarks ?? "",
    }));
    const cols = ["task_code","task_name","client","project_name","priority","status","assigned_to","reviewer","due_date","planned_hours","actual_hours","remarks"];
    downloadCSV(`tasks-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
  };

  const load = async () => {
    const [{ data: t }, { data: p }, { data: e }] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,display_name,avatar_url"),
      supabase.from("profile_emails" as never).select("id,email") as never,
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
    const map: Record<string, string> = {};
    for (const row of ((e ?? []) as Array<{ id: string; email: string }>)) map[row.id] = row.email;
    setEmails(map);
  };
  useEffect(() => { load(); }, []);
  useRealtimeTasks(load, "tasks-page-rt");

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
      load();
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
      load();
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
      load();
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
      load();
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
              remarks: t.remarks,
              custom_fields: t.custom_fields || {},
            },
            user?.id || ""
          )
        )
      );
      toast.success(`Successfully duplicated ${tasksToDuplicate.length} tasks`);
      setSelectedTaskIds(new Set());
      load();
    } catch (err) {
      toast.error("Failed to duplicate tasks: " + (err as Error).message);
    }
  };

  const handleDeleteAll = async () => {
    try {
      await Promise.all(tasks.map((t) => tasksService.delete(t.id)));
      toast.success("All tasks deleted successfully");
      setConfirmDeleteAllText("");
      setDeleteAllOpen(false);
      setSelectedTaskIds(new Set());
      load();
    } catch (err) {
      toast.error("Failed to delete tasks: " + (err as Error).message);
    }
  };

  // Base filtered list with date filters
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
      if (status !== ALL && t.status !== status) return false;
      if (priority !== ALL && t.priority !== priority) return false;
      if (assignee !== ALL && t.assigned_to !== assignee) return false;
      if (q) {
        const assigneeName = nameOf(t.assigned_to);
        const assigneeEmail = t.assigned_to ? emails[t.assigned_to] ?? "" : "";
        const reviewerName = nameOf(t.reviewer);
        const combinedText = `${t.task_code || ""} ${t.task_name || ""} ${t.client || ""} ${t.project_name || ""} ${assigneeName} ${assigneeEmail} ${reviewerName}`.toLowerCase();
        if (!combinedText.includes(q.toLowerCase())) return false;
      }
      
      // Date filters
      if (dateFilter === "today" && t.due_date !== todayStr) return false;
      if (dateFilter === "tomorrow" && t.due_date !== tomorrowStr) return false;
      if (dateFilter === "this_week") {
        if (!t.due_date || t.due_date < startOfWeekStr || t.due_date > endOfWeekStr) return false;
      }
      if (dateFilter === "overdue") {
        if (!t.due_date || t.due_date >= todayStr || t.status === "Completed") return false;
      }
      if (dateFilter === "no_due_date" && t.due_date) return false;

      return true;
    });
  }, [tasks, q, status, priority, assignee, dateFilter]);

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
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (sortBy === "due_late") {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
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
        onChanged={load}
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

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 py-5 space-y-5 pb-24">
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        
        {/* Sticky Top Header Bar with Title, Tabs & Actions */}
        <div className="sticky top-[96px] z-15 transform-gpu bg-card/95 border border-border/80 p-3.5 rounded-xl shadow-2xs flex flex-col md:flex-row md:items-center md:justify-between gap-3 backdrop-blur mb-5">
          
          {/* Left: Title + My Tasks / Team Tasks / All Tasks Tabs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 pr-2 border-r border-border/60">
              <h1 className="text-xl font-bold tracking-tight text-foreground">Tasks</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#5C8EFA]/20 text-[#5C8EFA] border border-[#5C8EFA]/30">
                {sorted.length}
              </span>
            </div>

            <TabsList className="bg-background/90 border border-border/80 flex overflow-x-auto justify-start sm:inline-flex scrollbar-none gap-1 h-auto p-1">
              <TabsTrigger value="my_tasks" className="text-xs shrink-0 whitespace-nowrap px-3 data-[state=active]:bg-accent data-[state=active]:text-[#5C8EFA] data-[state=active]:font-bold">
                My Tasks ({myTasks.length})
              </TabsTrigger>
              <TabsTrigger value="team_tasks" className="text-xs shrink-0 whitespace-nowrap px-3 data-[state=active]:bg-accent data-[state=active]:text-[#5C8EFA] data-[state=active]:font-bold">
                Team Tasks ({teamTasks.length})
              </TabsTrigger>
              <TabsTrigger value="all_tasks" className="text-xs shrink-0 whitespace-nowrap px-3 data-[state=active]:bg-accent data-[state=active]:text-[#5C8EFA] data-[state=active]:font-bold">
                All Tasks ({sorted.length})
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <Button size="sm" variant="outline" className="h-8 border-border bg-background hover:bg-accent text-foreground" onClick={() => setImportOpen(true)} title="Import CSV">
              <Upload className="h-3.5 w-3.5 mr-1 text-[#5C8EFA]" /> Import
            </Button>
            <Button size="sm" variant="outline" className="h-8 border-border bg-background hover:bg-accent text-foreground" onClick={exportCSV} title="Export filtered tasks">
              <Download className="h-3.5 w-3.5 mr-1 text-[#5C8EFA]" /> Export
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300" onClick={() => setDeleteAllOpen(true)} title="Delete all tasks">
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete All
            </Button>
            <Button size="sm" className="h-8 bg-[#5C8EFA] hover:bg-[#4A7DE7] text-[#0A0F1D] font-bold" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1 text-[#0A0F1D]" /> New task
            </Button>
          </div>
        </div>

        {/* 2-Column Main Layout: Left Sidebar Filters + Right Task Cards */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          
          {/* LEFT SIDEBAR FILTER PANEL */}
          <aside className="w-full lg:w-64 shrink-0 bg-card border border-border/80 rounded-xl p-4 space-y-4 shadow-2xs lg:sticky lg:top-[168px] transform-gpu">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[#5C8EFA]" />
                <span className="font-bold text-sm text-foreground">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="text-[10px] font-bold bg-[#5C8EFA] text-[#0A0F1D] px-1.5 py-0.2 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="text-xs font-semibold text-[#5C8EFA] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Clear all</span>
                </button>
              )}
            </div>

            <div className="space-y-3.5">
              {/* Search Input */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 text-xs bg-background/80 border-input text-foreground placeholder:text-muted-foreground focus:border-[#5C8EFA]"
                    placeholder="Search tasks..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 w-full text-xs bg-background/80 border-input text-foreground">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-popover-foreground">
                    <SelectItem value={ALL}>All Statuses</SelectItem>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Priority</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-8 w-full text-xs bg-background/80 border-input text-foreground">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-popover-foreground">
                    <SelectItem value={ALL}>All Priorities</SelectItem>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Assignee Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Assignee</label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger className="h-8 w-full text-xs bg-background/80 border-input text-foreground">
                    <SelectValue placeholder="Assignee" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-popover-foreground">
                    <SelectItem value={ALL}>All Assignees</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Due Date</label>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="h-8 w-full text-xs bg-background/80 border-input text-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 shrink-0 text-[#5C8EFA]" />
                      <SelectValue placeholder="Date" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-popover-foreground">
                    <SelectItem value={ALL}>All Dates</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="tomorrow">Tomorrow</SelectItem>
                    <SelectItem value="this_week">This Week</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="no_due_date">No Due Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort Order */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Sort By</label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-8 w-full text-xs bg-background/80 border-input text-foreground">
                    <div className="flex items-center gap-1">
                      <ArrowUpDown className="h-3 w-3 shrink-0 text-[#5C8EFA]" />
                      <SelectValue placeholder="Sort By" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-popover-foreground">
                    <SelectItem value="newest">Newest Created</SelectItem>
                    <SelectItem value="oldest">Oldest Created</SelectItem>
                    <SelectItem value="due_soon">Due Date (Soonest)</SelectItem>
                    <SelectItem value="due_late">Due Date (Latest)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </aside>

          {/* RIGHT CONTENT PANEL: Task Cards List */}
          <div className="flex-1 min-w-0 space-y-4 w-full">
            
            {/* Select All Checkbox bar */}
            <div className="flex items-center justify-end px-1 select-none">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
                <input
                  type="checkbox"
                  checked={currentTabTasks.length > 0 && currentTabTasks.every(t => selectedTaskIds.has(t.id))}
                  ref={el => {
                    if (el) {
                      const someSelected = currentTabTasks.some(t => selectedTaskIds.has(t.id));
                      const allSelected = currentTabTasks.every(t => selectedTaskIds.has(t.id));
                      el.indeterminate = someSelected && !allSelected;
                    }
                  }}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    const newSelection = new Set(selectedTaskIds);
                    currentTabTasks.forEach(t => {
                      if (checked) {
                        newSelection.add(t.id);
                      } else {
                        newSelection.delete(t.id);
                      }
                    });
                    setSelectedTaskIds(newSelection);
                  }}
                  className="h-3.5 w-3.5 rounded border-input bg-background text-[#5C8EFA] accent-[#5C8EFA] cursor-pointer"
                />
                Select All
              </label>
            </div>

            <TabsContent value="my_tasks" className="mt-0">
              {myTasks.length > 0 ? (
                renderWhatsAppGroupedTasks(myTasks)
              ) : (
                <p className="text-sm text-muted-foreground italic py-12 text-center bg-card/40 rounded-xl border border-dashed border-border/80">
                  No tasks assigned to you.
                </p>
              )}
            </TabsContent>

            <TabsContent value="team_tasks" className="mt-0">
              {teamTasks.length > 0 ? (
                renderWhatsAppGroupedTasks(teamTasks)
              ) : (
                <p className="text-sm text-muted-foreground italic py-12 text-center bg-card/40 rounded-xl border border-dashed border-border/80">
                  No team tasks found.
                </p>
              )}
            </TabsContent>

            <TabsContent value="all_tasks" className="mt-0">
              {sorted.length > 0 ? (
                renderWhatsAppGroupedTasks(sorted)
              ) : (
                <p className="text-sm text-muted-foreground italic py-12 text-center bg-card/40 rounded-xl border border-dashed border-border/80">
                  No tasks match the filters.
                </p>
              )}
            </TabsContent>
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

      {/* Delete All Confirm Dialog */}
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent className="bg-[#0B1220] border-slate-800 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete All Tasks?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This action will permanently delete all tasks in the system. This cannot be undone.
              To confirm this action, please type <strong className="text-white font-semibold">DELETE ALL</strong> below:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              placeholder="Type DELETE ALL"
              value={confirmDeleteAllText}
              onChange={(e) => setConfirmDeleteAllText(e.target.value)}
              className="h-9 bg-[#070B14] border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>
          <AlertDialogFooter>
            <Button variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => {
              setDeleteAllOpen(false);
              setConfirmDeleteAllText("");
            }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmDeleteAllText !== "DELETE ALL"}
              onClick={handleDeleteAll}
            >
              Delete All Tasks
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TaskFormDialog open={dialogOpen} onOpenChange={setDialogOpen} userId={user.id} onSaved={load} />
      <CSVImportDialog open={importOpen} onOpenChange={setImportOpen} profiles={profiles} userId={user.id} isManager={isManager} onDone={load} />
    </div>
  );
}
