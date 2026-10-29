import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
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
import { Plus, Search, Upload, Download, Calendar, ArrowUpDown, Copy, Filter, RotateCcw, List, ChevronLeft, ChevronRight, CheckCircle2, Clock, User, Users } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task } from "@/lib/types";
import { getDefaultStartDate } from "@/lib/format";
import { CSVImportDialog } from "@/components/CSVImportDialog";
import { downloadCSV, toCSV } from "@/lib/csv";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { tasksService } from "@/services/tasks";
import {
  fetchTasksByIds,
  fetchTaskWithWorklogs,
} from "@/lib/task-window";
import {
  fetchAllTaskRows,
  fetchHeaderCounts,
  fetchSidebarCounts,
  fetchTabCounts,
  fetchTaskListPage,
  fetchTaskListSignature,
  type HeaderCounts,
  type Person,
  type SidebarCounts,
  type TabCounts,
  type TaskListParams,
  type TaskTab,
} from "@/lib/task-list-query";
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
  const { user, isManager, rolesReady } = useAuth();
  const { taskId, highlightId, create, search: searchParam, assignee: assigneeParam, tab: tabParam, status: statusParam } = Route.useSearch();
  const navigate = useNavigate({ from: "/tasks" });

  // The list is read PAGE BY PAGE from the API: the tab scope, filters, search, sorting, the page itself and
  // every counter are applied by the server (see task-list-query.ts). Only the page on screen is in memory.
  // A member is always limited to their own assigned tasks in these queries.
  const canSeeAll = isManager;
  const ready = !!user?.id && rolesReady;
  const [pageRows, setPageRows] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const pageRowsRef = useRef<Task[]>([]);
  pageRowsRef.current = pageRows;
  const totalRef = useRef(0);
  totalRef.current = total;
  const [sidebar, setSidebar] = useState<SidebarCounts | null>(null);
  const [tabCounts, setTabCounts] = useState<TabCounts | null>(null);
  const [header, setHeader] = useState<HeaderCounts | null>(null);
  const [countsTick, setCountsTick] = useState(0);
  const [peopleReady, setPeopleReady] = useState(false);
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
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [selectedDetailTask, setSelectedDetailTask] = useState<Task | null>(null);

  // Pagination states
  const [pageSize, setPageSize] = useState<number>(25);
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

  // The page number belongs to the query it was chosen for: change the tab / a filter / the sort / the page
  // size and it is page 1 again, without a second request for a page that no longer exists.
  const shapeKey = JSON.stringify([q, [...selectedStatuses].sort(), [...selectedPriorities].sort(), assignee, dateFilter, activeTab, pageSize, sortBy]);
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: shapeKey, page: 1 });
  const currentPage = pageState.key === shapeKey ? pageState.page : 1;
  const setCurrentPage = (page: number) => setPageState({ key: shapeKey, page });

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

  const todayStr = () => new Date().toISOString().slice(0, 10);

  // Every task that matches the current filters (all tabs, the viewer's scope applies), read in chunks.
  const exportCSV = async () => {
    try {
      toast.info("Preparing export…");
      const all = await fetchAllTaskRows({ ...paramsRef.current, tab: "all_tasks" });
      const rows = all.map((t) => ({
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
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Could not export tasks");
    }
  };

  // People (names for search and display, emails for search): loaded once.
  useEffect(() => {
    void (async () => {
      try {
        const [{ data: p }, { data: e }] = await Promise.all([
          supabase.from("profiles").select("id,display_name,avatar_url"),
          supabase.from("profile_emails" as never).select("id,email") as never,
        ]);
        setProfiles((p ?? []) as Profile[]);
        const map: Record<string, string> = {};
        for (const row of ((e ?? []) as Array<{ id: string; email: string }>)) map[row.id] = row.email;
        setEmails(map);
      } catch (err) {
        console.error("Failed to load people:", err);
      } finally {
        setPeopleReady(true);
      }
    })();
  }, []);

  const people = useMemo<Person[]>(
    () => profiles.map((p) => ({ id: p.id, name: p.display_name ?? "", email: emails[p.id] ?? "" })),
    [profiles, emails],
  );
  const scope = useMemo(() => ({ userId: user?.id ?? "", canSeeAll }), [user?.id, canSeeAll]);
  // A member only ever has the "my tasks" tab, whatever the URL asked for.
  const tab: TaskTab = canSeeAll ? (activeTab as TaskTab) : "my_tasks";
  const filters = useMemo(
    () => ({ statuses: [...selectedStatuses].sort(), priorities: [...selectedPriorities].sort(), assignee, q, dateFilter }),
    [selectedStatuses, selectedPriorities, assignee, q, dateFilter],
  );
  const params: TaskListParams = { scope, tab, filters, sortBy, page: currentPage, pageSize, people };
  const paramsRef = useRef(params);
  paramsRef.current = params;
  // The search needs the people list; without a search the people are irrelevant to the query (no re-run when they arrive).
  const peopleOk = !q.trim() || peopleReady;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const filterKey = JSON.stringify(filters) + (q.trim() ? people.length : "");
  const pageKey = JSON.stringify([scope, tab, filterKey, sortBy, currentPage, pageSize]);

  // The page itself: ONE request returning pageSize rows (with their worklogs) and the exact total.
  const pageReq = useRef(0);
  useEffect(() => {
    if (!ready || !peopleOk) return;
    const id = ++pageReq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchTaskListPage(paramsRef.current, todayStr());
        if (id !== pageReq.current) return;
        setPageRows(res.rows as Task[]);
        setTotal(res.total);
        const pages = Math.max(1, Math.ceil(res.total / pageSize));
        if (currentPage > pages) setCurrentPage(pages); // e.g. the last row of the last page was deleted
      } catch (err) {
        console.error("Failed to load tasks:", err);
      } finally {
        if (id === pageReq.current) setInitialLoading(false);
      }
    }, q.trim() ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, ready, peopleOk]);

  // Counters: sidebar (status / priority of the active tab), tab labels (current filters), KPI strip.
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    fetchSidebarCounts(tab, scope).then((r) => !stale && setSidebar(r)).catch((e) => console.error("Sidebar counts failed:", e));
    return () => { stale = true; };
  }, [tab, scope, countsTick, ready]);
  useEffect(() => {
    if (!ready || !peopleOk) return;
    let stale = false;
    const timer = setTimeout(() => {
      fetchTabCounts(paramsRef.current).then((r) => !stale && setTabCounts(r)).catch((e) => console.error("Tab counts failed:", e));
    }, q.trim() ? 250 : 0);
    return () => { stale = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, scope, countsTick, peopleOk, ready]);
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    fetchHeaderCounts(scope).then((r) => !stale && setHeader(r)).catch((e) => console.error("Header counts failed:", e));
    return () => { stale = true; };
  }, [scope, countsTick, ready]);

  // A change elsewhere (realtime) or after one of our own actions: ask for the SAME page's ids + updated_at
  // (~70 bytes a row), read full rows only for what changed, and refresh the counters once things settle.
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPage = async () => {
    const p = paramsRef.current;
    if (!readyRef.current) return;
    try {
      const sig = await fetchTaskListSignature(p);
      const cur = pageRowsRef.current;
      const byId = new Map<string, Task>(cur.map((r) => [r.id, r]));
      const changed = sig.ids.filter((rid) => byId.get(rid)?.updated_at !== sig.updatedAt[rid]);
      const same = sig.ids.length === cur.length && sig.ids.every((rid, i) => cur[i].id === rid);
      if (!(same && changed.length === 0 && sig.total === totalRef.current)) {
        if (changed.length > 0) {
          for (const r of await fetchTasksByIds(changed, todayStr())) byId.set(r.id, r as Task);
        }
        const next = sig.ids.map((rid) => byId.get(rid));
        if (next.some((r) => !r)) throw new Error("page rows missing");
        setPageRows(next as Task[]);
        setTotal(sig.total);
        const pages = Math.max(1, Math.ceil(sig.total / p.pageSize));
        if (p.page > pages) setCurrentPage(pages);
      }
    } catch (err) {
      console.warn("Page refresh failed; reading the page again:", err);
      try {
        const res = await fetchTaskListPage(paramsRef.current, todayStr());
        setPageRows(res.rows as Task[]);
        setTotal(res.total);
      } catch (e2) {
        console.error("Failed to load tasks:", e2);
      }
    }
    if (countsTimer.current) clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(() => setCountsTick((n) => n + 1), 1200);
  };
  // Existing call sites (cards, bulk actions) call load(true) after a change.
  const load = async (_silent = false) => {
    await refreshPage();
  };
  useRealtimeTasks(() => void refreshPage(), "tasks-page-rt");

  // Sidebar counters come straight from the server (active tab, not narrowed by the other filters).
  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of TASK_STATUSES) map[s] = sidebar?.status[s] ?? 0;
    return map;
  }, [sidebar]);
  const priorityCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of TASK_PRIORITIES) map[p] = sidebar?.priority[p] ?? 0;
    return map;
  }, [sidebar]);

  // Deep links (notification / My Day / Calendar): the task may be on any page, so read it directly,
  // open its details, and show the tab it belongs to.
  const autoOpenedTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    const targetId = taskId || highlightId;
    if (!targetId || !ready || !user?.id || autoOpenedTargetIdRef.current === targetId) return;
    autoOpenedTargetIdRef.current = targetId;
    void fetchTaskWithWorklogs(targetId, todayStr()).then((t) => {
      if (!t) return;
      setSelectedDetailTask(t as Task);
      if (highlightId && canSeeAll) setActiveTab(t.assigned_to === user.id ? "my_tasks" : "team_tasks");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, highlightId, user?.id, ready]);


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

  // Bulk actions work on whole rows (they are written back / copied), but the list only holds light ones.
  const selectedFull = async (): Promise<Task[]> =>
    (await fetchTasksByIds([...selectedTaskIds], new Date().toISOString().slice(0, 10))) as Task[];

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
      const selected = await selectedFull();
      // Tasks in review are completed by their reviewer's approval, not in bulk.
      const tasksToUpdate = selected.filter((t) => t.status !== "In Review");
      await Promise.all(tasksToUpdate.map((t) => tasksService.setStatus(t, "Completed", user?.id || "")));
      toast.success(`Successfully completed ${tasksToUpdate.length} tasks`);
      if (selected.length > tasksToUpdate.length) {
        toast.info(`${selected.length - tasksToUpdate.length} task(s) in review were skipped. They need reviewer approval.`);
      }
      setSelectedTaskIds(new Set());
      load(true);
    } catch (err) {
      toast.error("Failed to update tasks: " + (err as Error).message);
    }
  };

  const handleBulkReassign = async (newAssigneeId: string) => {
    if (!newAssigneeId) return;
    try {
      const tasksToUpdate = await selectedFull();
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
    const defaultVal = pageRows.find(t => selectedTaskIds.has(t.id))?.project_name ?? "";
    const newProject = prompt("Enter new project name for selected tasks:", defaultVal);
    if (newProject === null) return;
    
    try {
      const tasksToUpdate = await selectedFull();
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
      const tasksToDuplicate = await selectedFull();
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
              due_date: defaultStartDate,
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

  // Page number box follows the page actually shown.
  const totalItems = total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const validatedPage = Math.min(Math.max(1, currentPage), totalPages);
  useEffect(() => {
    setPageInput(String(validatedPage));
  }, [validatedPage]);
  const paginatedTasks = pageRows;
  const rangeStart = pageRows.length === 0 ? 0 : (validatedPage - 1) * pageSize + 1;
  const rangeEnd = pageRows.length === 0 ? 0 : (validatedPage - 1) * pageSize + pageRows.length;


  // Scroll + highlight task when coming from a notification click
  useEffect(() => {
    if (!highlightId || pageRows.length === 0) return;
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
  }, [highlightId, pageRows, navigate, activeTab]);

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

  const overdueCount = header?.overdue ?? 0;

  const renderFilterControls = () => (
    <div className="space-y-4 text-xs">
      {/* Header: Filters + Reset link */}
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
        {/* Search Box */}
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

        {/* Status Checkbox Filter */}
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

        {/* Priority Checkbox Filter */}
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

        {/* Assignee Filter */}
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

        {/* Due Date Filter */}
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

        {/* Sort By Filter */}
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
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 py-1.5 sm:py-2 text-slate-100 flex flex-col h-full lg:h-[calc(100vh-105px)] overflow-y-auto lg:overflow-hidden w-full pb-16 md:pb-4">
      
      {/* Top Header Row & KPI Metric Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 select-none shrink-0 mb-1.5 sm:mb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-tight">Tasks</h1>
            <span className="text-[11px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-[#1e2d4a] text-[#5C8EFA] border border-[#2b3e66]">
              {header?.total ?? 0}
            </span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-[#8a99ad] font-medium leading-tight">Plan, track and get things done</p>
        </div>

        {/* KPI Summary Cards - compact micro-cards on mobile */}
        <div className={cn("grid grid-cols-2 gap-1.5 shrink-0", canSeeAll ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          <div className="bg-[#181a20] border border-[#262936] rounded-lg px-2.5 py-1 sm:px-3 sm:py-1.5 flex items-center gap-2">
            <div className="h-6 w-6 sm:h-7 sm:w-7 rounded-md bg-[#5C8EFA]/15 flex items-center justify-center shrink-0">
              <User className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#5C8EFA]" />
            </div>
            <div>
              <p className="text-xs sm:text-base font-bold text-white leading-none">
                {header?.mine ?? 0}
              </p>
              <p className="text-[10px] sm:text-[11px] text-[#8a99ad] mt-0.5 font-medium">My Tasks</p>
            </div>
          </div>

          <div className={cn("bg-[#181a20] border border-[#262936] rounded-lg px-2.5 py-1 sm:px-3 sm:py-1.5 flex items-center gap-2", !canSeeAll && "hidden")}>
            <div className="h-6 w-6 sm:h-7 sm:w-7 rounded-md bg-emerald-500/15 flex items-center justify-center shrink-0">
              <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs sm:text-base font-bold text-white leading-none">
                {canSeeAll ? Math.max(0, (header?.total ?? 0) - (header?.mine ?? 0)) : 0}
              </p>
              <p className="text-[10px] sm:text-[11px] text-[#8a99ad] mt-0.5 font-medium">Team Tasks</p>
            </div>
          </div>

          <div className="bg-[#181a20] border border-[#262936] rounded-lg px-2.5 py-1 sm:px-3 sm:py-1.5 flex items-center gap-2">
            <div className="h-6 w-6 sm:h-7 sm:w-7 rounded-md bg-rose-500/15 flex items-center justify-center shrink-0">
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-400" />
            </div>
            <div>
              <p className="text-xs sm:text-base font-bold text-rose-400 leading-none">{overdueCount}</p>
              <p className="text-[10px] sm:text-[11px] text-[#8a99ad] mt-0.5 font-medium">Overdue</p>
            </div>
          </div>
        </div>

      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        
        {/* Navigation Bar with Tabs & Actions */}
        <div className="bg-[#181a20] border border-[#262936] p-1.5 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0 mb-1.5 sm:mb-2">
          
          {/* Tabs List */}
          <TabsList className="bg-transparent border-none flex overflow-x-auto justify-start scrollbar-none gap-1 sm:gap-2 h-auto p-0 w-full sm:w-auto">
            <TabsTrigger
              value="my_tasks"
              className="text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg font-medium transition-all text-[#8a99ad] hover:text-white data-[state=active]:bg-[#252834] data-[state=active]:text-[#5C8EFA] data-[state=active]:border data-[state=active]:border-[#35394b] data-[state=active]:font-bold cursor-pointer whitespace-nowrap"
            >
              My Tasks ({tabCounts?.my ?? 0})
            </TabsTrigger>
            <TabsTrigger
              hidden={!canSeeAll}
              value="team_tasks"
              className="text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg font-medium transition-all text-[#8a99ad] hover:text-white data-[state=active]:bg-[#252834] data-[state=active]:text-[#5C8EFA] data-[state=active]:border data-[state=active]:border-[#35394b] data-[state=active]:font-bold cursor-pointer whitespace-nowrap"
            >
              Team Tasks ({tabCounts?.team ?? 0})
            </TabsTrigger>
            <TabsTrigger
              hidden={!canSeeAll}
              value="all_tasks"
              className="text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg font-medium transition-all text-[#8a99ad] hover:text-white data-[state=active]:bg-[#252834] data-[state=active]:text-[#5C8EFA] data-[state=active]:border data-[state=active]:border-[#35394b] data-[state=active]:font-bold cursor-pointer whitespace-nowrap"
            >
              All Tasks ({tabCounts?.all ?? 0})
            </TabsTrigger>
          </TabsList>

          {/* Actions Bar */}
          <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto justify-between sm:justify-end">
            
            {/* Mobile Filter Button (< lg) */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMobileFilterOpen(true)}
              className="lg:hidden h-7 sm:h-8 text-xs border-[#262936] bg-[#111319] hover:bg-[#222530] text-slate-200 cursor-pointer px-2.5"
            >
              <Filter className="h-3.5 w-3.5 mr-1 text-[#5C8EFA]" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="ml-1 text-[10px] font-bold bg-[#5C8EFA] text-[#0A0F1D] px-1.5 py-0.2 rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button size="sm" variant="outline" className="h-7 sm:h-8 text-xs border-[#262936] bg-[#111319] hover:bg-[#222530] text-slate-200 cursor-pointer px-2 sm:px-3" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5 sm:mr-1.5 text-[#5C8EFA]" />
                <span className="hidden xs:inline">Import</span>
              </Button>
              <Button size="sm" variant="outline" className="h-7 sm:h-8 text-xs border-[#262936] bg-[#111319] hover:bg-[#222530] text-slate-200 cursor-pointer px-2 sm:px-3" onClick={exportCSV}>
                <Download className="h-3.5 w-3.5 sm:mr-1.5 text-[#5C8EFA]" />
                <span className="hidden xs:inline">Export</span>
              </Button>
              <Button size="sm" variant="outline" className="h-7 sm:h-8 text-xs border-[#35394b] bg-[#252834] hover:bg-[#2f3342] text-[#5C8EFA] font-bold px-2.5 sm:px-3 cursor-pointer whitespace-nowrap" onClick={() => setDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 text-[#5C8EFA]" />
                <span>New task</span>
              </Button>
            </div>

          </div>
        </div>

        {/* 2-Column Layout: Left Desktop Sidebar Filters + Right Task List */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-5 items-stretch overflow-hidden">
          
          {/* DESKTOP SIDEBAR FILTER PANEL (Hidden on mobile < lg) */}
          <aside className="hidden lg:block w-64 shrink-0 bg-[#181a20] border border-[#262936] rounded-xl p-4 overflow-y-auto custom-scrollbar h-full">
            {renderFilterControls()}
          </aside>

          {/* MOBILE SLIDE-OVER FILTER SHEET (< lg) */}
          <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
            <SheetContent side="left" className="w-80 p-4 bg-[#181a20] text-slate-100 border-r border-[#262936] overflow-y-auto custom-scrollbar">
              <SheetHeader className="mb-3 text-left">
                <SheetTitle className="text-white text-base font-bold flex items-center gap-2">
                  <Filter className="h-4 w-4 text-[#5C8EFA]" /> Filter Tasks
                </SheetTitle>
              </SheetHeader>
              {renderFilterControls()}
            </SheetContent>
          </Sheet>

          {/* RIGHT MAIN PANEL: Task List + Page Size Header + Bottom Pagination */}
          <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-transparent">
            
            {/* List Header Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 shrink-0 pb-2">
              <div className="text-xs text-[#8a99ad] font-medium">
                Showing {rangeStart}–{rangeEnd} of {totalItems} tasks
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
                  Showing {rangeStart}–{rangeEnd} of {totalItems} tasks
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
              autoOpenedTargetIdRef.current = null;
              if (taskId || highlightId) {
                navigate({
                  search: (prev) => ({
                    ...prev,
                    taskId: undefined,
                    highlightId: undefined,
                  }),
                  replace: true,
                });
              }
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
