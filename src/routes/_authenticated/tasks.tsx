import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Plus, Search, Upload, Download } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task } from "@/lib/types";
import { CSVImportDialog } from "@/components/CSVImportDialog";
import { downloadCSV, toCSV } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (search: Record<string, unknown>) => ({
    highlightId: typeof search.highlightId === "string" ? search.highlightId : undefined,
  }),
  component: TasksPage,
});

const ALL = "__all";

function TasksPage() {
  const { user, isManager } = useAuth();
  const { highlightId } = Route.useSearch();
  const navigate = useNavigate({ from: "/tasks" });
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [assignee, setAssignee] = useState<string>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const emailOf = (id: string | null) => (id ? emails[id] ?? "" : "");

  const exportCSV = () => {
    const rows = filtered.map((t) => ({
      task_code: t.task_code,
      task_name: t.task_name,
      client: t.client ?? "",
      project_name: t.project_name ?? "",
      priority: t.priority,
      status: t.status,
      assigned_to_email: emailOf(t.assigned_to),
      reviewer_email: emailOf(t.reviewer),
      due_date: t.due_date ?? "",
      planned_hours: t.planned_hours ?? "",
      actual_hours: t.actual_hours ?? "",
      sprint_week: t.sprint_week ?? "",
      remarks: t.remarks ?? "",
    }));
    const cols = ["task_code","task_name","client","project_name","priority","status","assigned_to_email","reviewer_email","due_date","planned_hours","actual_hours","sprint_week","remarks"];
    downloadCSV(`tasks-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
  };

  const load = async () => {
    const [{ data: t }, { data: p }, { data: e }] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,display_name,avatar_url"),
      // profile_emails is a security_invoker view that only returns rows the
      // caller is allowed to see (self + managers/admins see all).
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

  // Sort: logged-in user's tasks first, then everyone else's
  const filtered = useMemo(() => {
    const base = tasks.filter((t) => {
      if (status !== ALL && t.status !== status) return false;
      if (priority !== ALL && t.priority !== priority) return false;
      if (assignee !== ALL && t.assigned_to !== assignee) return false;
      if (q && !`${t.task_code} ${t.task_name} ${t.client ?? ""} ${t.project_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    // Put current user's tasks at the top
    if (user) {
      return [...base].sort((a, b) => {
        const aIsMe = a.assigned_to === user.id ? 0 : 1;
        const bIsMe = b.assigned_to === user.id ? 0 : 1;
        return aIsMe - bIsMe;
      });
    }
    return base;
  }, [tasks, q, status, priority, assignee, user]);

  // Scroll to and briefly highlight the task referenced from a notification
  useEffect(() => {
    if (!highlightId || filtered.length === 0) return;
    const el = document.getElementById(`task-card-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2");
      const t = setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
        // Remove highlightId from the URL so refresh doesn't re-scroll
        navigate({ search: {} as never, replace: true });
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [highlightId, filtered]);

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setImportOpen(true)} title="Import CSV">
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={exportCSV} title="Export filtered tasks">
            <Download className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> New task</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-7 h-8 text-sm" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All status</SelectItem>
            {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priority</SelectItem>
            {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Assignee" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} tasks</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filtered.map((t) => (
          <div key={t.id} id={`task-card-${t.id}`} ref={highlightId === t.id ? highlightRef : undefined} className="rounded-lg transition-shadow duration-300">
            <TaskCard
              task={t}
              assignee={profiles.find((p) => p.id === t.assigned_to)}
              profiles={profiles}
              userId={user.id}
              canManage={isManager}
              onChanged={load}
            />
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground italic">No tasks match.</p>}
      </div>

      <TaskFormDialog open={dialogOpen} onOpenChange={setDialogOpen} userId={user.id} onSaved={load} />
      <CSVImportDialog open={importOpen} onOpenChange={setImportOpen} profiles={profiles} userId={user.id} onDone={load} />
    </div>
  );
}
