import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task, type TaskHistory, type WorkItemType } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getLocalHoliday, fetchIndianHolidays, formatRelative, type Holiday } from "@/lib/format";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { workItemTypesService } from "@/services/work-item-types";
import { dynamicFieldsService, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { DynamicFieldsForm } from "@/components/DynamicFieldsForm";
import { CommentsPanel } from "@/components/CommentsPanel";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { cn } from "@/lib/utils";
import {
  User,
  Users,
  ListPlus,
  Plus,
  Trash2,
  X,
  ChevronsUpDown,
  Sparkles,
  Loader2,
  CheckCircle2,
  Clock,
  MessageSquare,
  Paperclip,
  Activity,
  Maximize2,
  Minimize2,
  ArrowRightCircle,
} from "lucide-react";

const NONE = "__none";

type CreationMode = "single" | "bulk_same" | "grid";

interface GridRow {
  id: string;
  task_name: string;
  assigned_to: string | null;
  type_id: string | null;
  client: string;
  isCustomClient?: boolean;
  project_name: string;
  isCustomProj?: boolean;
  priority: Task["priority"];
  start_date: string | null;
  due_date: string | null;
  planned_hours: number;
}

export function TaskFormDialog({
  open,
  onOpenChange,
  initial,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Task | null;
  userId: string;
  onSaved: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; client: string | null }>>([]);
  const [form, setForm] = useState<Partial<Task>>(
    initial ?? { priority: "Medium", status: "To Do", custom_fields: {} }
  );
  const [fieldDefs, setFieldDefs] = useState<WorkItemFieldDef[]>([]);
  const [apiHolidays, setApiHolidays] = useState<Record<string, Holiday>>({});

  // UI State
  const [isExpanded, setIsExpanded] = useState(false);
  const [taskHistoryItems, setTaskHistoryItems] = useState<TaskHistory[]>([]);

  // Creation Mode State (Only active for New Task)
  const [creationMode, setCreationMode] = useState<CreationMode>("single");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isCustomProject, setIsCustomProject] = useState(false);
  const [isCustomClient, setIsCustomClient] = useState(false);

  // Multi-Task Grid State
  const [gridRows, setGridRows] = useState<GridRow[]>([
    { id: "1", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
    { id: "2", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
    { id: "3", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
  ]);

  const [prevOpen, setPrevOpen] = useState(false);
  const [prevInitialId, setPrevInitialId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open && form.due_date) {
      const year = new Date(form.due_date).getFullYear();
      if (!isNaN(year)) {
        fetchIndianHolidays(year).then(setApiHolidays).catch(() => {});
      }
    }
  }, [form.due_date, open]);

  useEffect(() => {
    if (open) {
      const isNewOpen = !prevOpen;
      const isDifferentTask = initial?.id !== prevInitialId;
      if (isNewOpen || isDifferentTask) {
        setForm(initial ?? { priority: "Medium", status: "To Do", custom_fields: {} });
        setCreationMode("single");
        setSelectedAssignees(initial?.assigned_to ? [initial.assigned_to] : []);
        setGridRows([
          { id: "1", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
          { id: "2", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
          { id: "3", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
        ]);
      }
    }
    setPrevOpen(open);
    setPrevInitialId(initial?.id);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("profiles")
      .select("id,display_name,avatar_url")
      .then(({ data }) => {
        setProfiles((data ?? []) as Profile[]);
      });
    workItemTypesService.list().then(setTypes).catch(() => setTypes([]));

    // Fetch both projects table AND distinct project/client names from tasks table
    Promise.all([
      supabase.from("projects").select("id, name, client").order("name", { ascending: true }),
      supabase.from("tasks").select("project_name, client"),
    ]).then(([projRes, taskRes]) => {
      const map = new Map<string, { id: string; name: string; client: string | null }>();

      // 1. Add entries from projects table (case-insensitive keys)
      (projRes.data ?? []).forEach((p) => {
        if (p.name?.trim()) {
          const key = p.name.trim().toLowerCase();
          map.set(key, { id: p.id, name: p.name.trim(), client: p.client?.trim() || null });
        }
      });

      // 2. Add entries directly typed by members in tasks table (deduplicating case-insensitively)
      (taskRes.data ?? []).forEach((t) => {
        if (t.project_name?.trim()) {
          const key = t.project_name.trim().toLowerCase();
          const existing = map.get(key);
          if (!existing) {
            map.set(key, {
              id: "",
              name: t.project_name.trim(),
              client: t.client?.trim() || null,
            });
          } else if (!existing.client && t.client?.trim()) {
            existing.client = t.client.trim();
          }
        }
      });

      setProjects(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, [open]);

  // Load task history timeline when task exists
  useEffect(() => {
    if (!open || !initial?.id) {
      setTaskHistoryItems([]);
      return;
    }
    supabase
      .from("task_history")
      .select("*")
      .eq("task_id", initial.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setTaskHistoryItems((data ?? []) as TaskHistory[]);
      });
  }, [open, initial?.id]);

  const uniqueClients = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => {
      if (p.client?.trim()) set.add(p.client.trim());
    });
    return Array.from(set).sort();
  }, [projects]);

  // Load field defs for the currently-selected type
  useEffect(() => {
    if (!open) return;
    if (!form.type_id) {
      setFieldDefs([]);
      return;
    }
    dynamicFieldsService.listDefs(form.type_id).then(setFieldDefs).catch(() => setFieldDefs([]));
  }, [open, form.type_id]);

  // Clean up custom_fields ONLY if fieldDefs are loaded
  useEffect(() => {
    if (!open || fieldDefs.length === 0) return;
    const allowed = new Set(fieldDefs.map((d) => d.key));
    const current = (form.custom_fields ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(current)) {
      if (allowed.has(k)) {
        next[k] = v;
      } else {
        changed = true;
      }
    }
    if (changed) {
      setForm((f) => ({ ...f, custom_fields: next }));
    }
  }, [fieldDefs, open]);

  // Helper functions for Bulk Assignees
  const toggleAssignee = (id: string) => {
    if (selectedAssignees.includes(id)) {
      setSelectedAssignees(selectedAssignees.filter((a) => a !== id));
    } else {
      setSelectedAssignees([...selectedAssignees, id]);
    }
  };

  const selectAllAssignees = () => {
    setSelectedAssignees(profiles.map((p) => p.id));
  };

  const clearAllAssignees = () => {
    setSelectedAssignees([]);
  };

  // Grid Row Handlers
  const updateGridRow = <K extends keyof GridRow>(id: string, key: K, value: GridRow[K]) => {
    setGridRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row))
    );
  };

  const addGridRow = () => {
    setGridRows((rows) => [
      ...rows,
      {
        id: String(Date.now()),
        task_name: "",
        assigned_to: null,
        type_id: form.type_id ?? null,
        client: form.client ?? "",
        project_name: form.project_name ?? "",
        priority: "Medium",
        start_date: form.start_date ?? null,
        due_date: form.due_date ?? null,
        planned_hours: 0,
      },
    ]);
  };

  const removeGridRow = (id: string) => {
    if (gridRows.length <= 1) {
      toast.error("At least one row is required in grid mode.");
      return;
    }
    setGridRows((rows) => rows.filter((r) => r.id !== id));
  };

  const clearGridRows = () => {
    setGridRows([
      { id: String(Date.now()), task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", start_date: null, due_date: null, planned_hours: 0 },
    ]);
  };

  // Toggle Completion Status
  const toggleMarkCompleted = () => {
    const isCompleted = form.status === "Completed";
    const nextStatus = isCompleted ? "To Do" : "Completed";
    setForm((prev) => ({
      ...prev,
      status: nextStatus,
      done: !isCompleted,
      completed_at: !isCompleted ? new Date().toISOString() : null,
    }));
    toast.info(`Task marked as ${nextStatus}`);
  };

  const ensureMasterProject = async (projectName?: string | null, clientName?: string | null) => {
    if (!projectName || !projectName.trim()) return;
    const name = projectName.trim();
    try {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .ilike("name", name)
        .maybeSingle();

      if (!data) {
        await supabase.from("projects").insert({
          name: name,
          client: clientName?.trim() || null,
          status: "active",
          sla_days: 3,
        });
      }
    } catch (err) {
      console.warn("Auto project master creation skipped:", err);
    }
  };

  // Main Save Handler
  const handleSave = async () => {
    if (form.project_name?.trim()) {
      await ensureMasterProject(form.project_name, form.client);
    }
    // 1. Edit existing task
    if (initial?.id) {
      if (!form.task_name?.trim()) {
        toast.error("Task name required");
        return;
      }
      const fieldsToValidate = { ...(form.custom_fields ?? {}) };
      delete fieldsToValidate.start_date;
      delete fieldsToValidate.checklist;
      const validation = dynamicFieldsService.validate(fieldDefs, fieldsToValidate);
      if (!validation.ok) {
        toast.error(validation.errors[0]);
        return;
      }
      setSaving(true);
      try {
        try {
          await tasksService.update(initial, form, userId);
        } catch (e) {
          if (e instanceof TaskConflictError) {
            const { data: freshRows } = await supabase
              .from("tasks")
              .select("*")
              .eq("id", initial.id)
              .single();
            if (freshRows) {
              await tasksService.update(freshRows as any, form, userId);
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
        toast.success("Task updated");
        onOpenChange(false);
        onSaved();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // 2. New Task: Multi-Task Grid Mode
    if (creationMode === "grid") {
      const validRows = gridRows.filter((r) => r.task_name.trim().length > 0);
      if (validRows.length === 0) {
        toast.error("Please enter at least one task name in the grid.");
        return;
      }
      setSaving(true);
      try {
        await Promise.all(
          validRows.map((row) =>
            tasksService.create(
              {
                task_name: row.task_name.trim(),
                assigned_to: row.assigned_to,
                type_id: row.type_id || form.type_id || null,
                client: row.client || form.client || null,
                project_name: row.project_name || form.project_name || null,
                priority: row.priority,
                start_date: row.start_date || form.start_date || null,
                due_date: row.due_date,
                planned_hours: Number(row.planned_hours) || 0,
                status: "To Do",
                remarks: form.remarks || null,
                custom_fields: form.custom_fields || {},
              },
              userId
            )
          )
        );
        toast.success(`Successfully created ${validRows.length} tasks!`);
        onOpenChange(false);
        onSaved();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // 3. New Task: Bulk Assign Mode
    if (creationMode === "bulk_same") {
      if (!form.task_name?.trim()) {
        toast.error("Task name required");
        return;
      }
      const fieldsToValidate = { ...(form.custom_fields ?? {}) };
      delete fieldsToValidate.start_date;
      delete fieldsToValidate.checklist;
      const validation = dynamicFieldsService.validate(fieldDefs, fieldsToValidate);
      if (!validation.ok) {
        toast.error(validation.errors[0]);
        return;
      }

      setSaving(true);
      try {
        if (selectedAssignees.length > 0) {
          await Promise.all(
            selectedAssignees.map((assigneeId) =>
              tasksService.create(
                {
                  ...form,
                  assigned_to: assigneeId,
                },
                userId
              )
            )
          );
          toast.success(`Created ${selectedAssignees.length} tasks for team members!`);
        } else {
          await tasksService.create({ ...form, assigned_to: null }, userId);
          toast.success("Task created (Unassigned)");
        }
        onOpenChange(false);
        onSaved();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // 4. New Task: Standard Single Task Mode
    if (!form.task_name?.trim()) {
      toast.error("Task name required");
      return;
    }
    const fieldsToValidate = { ...(form.custom_fields ?? {}) };
    delete fieldsToValidate.start_date;
    delete fieldsToValidate.checklist;
    const validation = dynamicFieldsService.validate(fieldDefs, fieldsToValidate);
    if (!validation.ok) {
      toast.error(validation.errors[0]);
      return;
    }

    setSaving(true);
    try {
      await tasksService.create(form, userId);
      toast.success("Task created");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      if (e instanceof TaskConflictError) {
        toast.error("Could not save – please close and try again.");
        onSaved();
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  const validGridRowCount = gridRows.filter((r) => r.task_name.trim().length > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col p-0 overflow-hidden transition-all duration-200 shadow-2xl bg-background text-foreground border border-border",
          isExpanded
            ? "w-[98vw] h-[95vh] max-h-[95vh] sm:max-w-[98vw] rounded-xl"
            : creationMode === "grid" && !initial
            ? "w-[96vw] max-h-[90vh] sm:max-w-6xl rounded-xl"
            : "w-[90vw] max-h-[85vh] sm:max-w-4xl lg:max-w-5xl rounded-xl"
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* Top Header Action Bar (Fixed at Top) */}
        <DialogHeader className="shrink-0 p-4 border-b border-border bg-card">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Quick Toggle Completion Status Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 gap-1.5 text-xs font-semibold rounded-lg transition-all",
                  form.status === "Completed"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                    : "bg-secondary text-foreground border-border hover:bg-muted"
                )}
                onClick={toggleMarkCompleted}
              >
                <CheckCircle2 className={cn("w-4 h-4", form.status === "Completed" ? "text-emerald-400" : "text-muted-foreground")} />
                <span>{form.status === "Completed" ? "Completed ✓" : "Mark as completed"}</span>
              </Button>

              {/* Task Code Badge */}
              <Badge variant="outline" className="bg-secondary text-primary border-primary/30 font-mono text-xs px-2.5 py-1">
                {initial?.task_code || "NEW TASK"}
              </Badge>
            </div>

            {/* Right Header Controls (Expand, Mode Switcher) */}
            <div className="flex items-center gap-1 pr-8 sm:pr-9">
              {!initial && (
                <div className="flex items-center gap-1 bg-secondary border border-border p-1 rounded-lg text-xs font-medium mr-2">
                  <button
                    type="button"
                    className={cn(
                      "py-1 px-2.5 rounded-md transition-all flex items-center gap-1.5 text-xs",
                      creationMode === "single"
                        ? "bg-primary text-primary-foreground font-semibold shadow"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setCreationMode("single")}
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Single</span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "py-1 px-2.5 rounded-md transition-all flex items-center gap-1.5 text-xs",
                      creationMode === "bulk_same"
                        ? "bg-primary text-primary-foreground font-semibold shadow"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setCreationMode("bulk_same")}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Bulk Team</span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "py-1 px-2.5 rounded-md transition-all flex items-center gap-1.5 text-xs",
                      creationMode === "grid"
                        ? "bg-primary text-primary-foreground font-semibold shadow"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setCreationMode("grid")}
                  >
                    <ListPlus className="w-3.5 h-3.5" />
                    <span>Multi Grid</span>
                  </button>
                </div>
              )}

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg hidden sm:flex"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Dialog Body (Flex-1 overflow-y-auto) */}
        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          {/* MODE 3: MULTI-TASK GRID VIEW */}
          {!initial && creationMode === "grid" ? (
            <div className="space-y-3">
              <div className="bg-primary/10 border border-primary/20 p-3 rounded-xl text-xs text-primary flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 shrink-0 text-primary" />
                  <span>
                    Each task row has its own <strong>Task Name, Assignee, Work Item Type, Client & Project</strong>.
                  </span>
                </div>
                <Badge variant="secondary" className="bg-primary/20 text-primary-foreground">
                  {validGridRowCount} task{validGridRowCount === 1 ? "" : "s"} ready
                </Badge>
              </div>

              <div className="border border-border rounded-xl overflow-x-auto max-h-[55vh] overflow-y-auto bg-card shadow-md">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead className="sticky top-0 bg-secondary z-10 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold border-b border-border">
                    <tr>
                      <th className="py-2 px-1.5 text-center w-7 border-r border-border/40">#</th>
                      <th className="py-2 px-2 min-w-[160px] border-r border-border/40">Task Name *</th>
                      <th className="py-2 px-1.5 min-w-[125px] border-r border-border/40">Assigned To</th>
                      <th className="py-2 px-1.5 min-w-[115px] border-r border-border/40">Work Type</th>
                      <th className="py-2 px-1.5 min-w-[115px] border-r border-border/40">Client</th>
                      <th className="py-2 px-1.5 min-w-[125px] border-r border-border/40">Project</th>
                      <th className="py-2 px-1.5 w-[90px] border-r border-border/40">Priority</th>
                      <th className="py-2 px-1.5 w-[115px] border-r border-border/40">Start Date</th>
                      <th className="py-2 px-1.5 w-[115px] border-r border-border/40">Due Date</th>
                      <th className="py-2 px-1.5 w-[55px] border-r border-border/40">Hrs</th>
                      <th className="py-2 px-1 text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {gridRows.map((row, index) => (
                      <tr key={row.id} className="hover:bg-muted/40 transition-colors">
                        <td className="py-1 px-1 text-center text-muted-foreground font-mono text-[10px] border-r border-border/40">
                          {index + 1}
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Input
                            className="h-7 text-[11px] px-2 bg-background border-border"
                            placeholder="Task title..."
                            value={row.task_name}
                            onChange={(e) => updateGridRow(row.id, "task_name", e.target.value)}
                          />
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Select
                            value={row.assigned_to ?? NONE}
                            onValueChange={(v) =>
                              updateGridRow(row.id, "assigned_to", v === NONE ? null : v)
                            }
                          >
                            <SelectTrigger className="h-7 text-[11px] px-1.5 bg-background border-border">
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Unassigned</SelectItem>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.display_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Select
                            value={row.type_id ?? NONE}
                            onValueChange={(v) =>
                              updateGridRow(row.id, "type_id", v === NONE ? null : v)
                            }
                          >
                            <SelectTrigger className="h-7 text-[11px] px-1.5 bg-background border-border">
                              <SelectValue placeholder="Default Task" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Default Task</SelectItem>
                              {types.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          {row.isCustomClient ? (
                            <div className="flex items-center gap-1">
                              <Input
                                className="h-7 text-[11px] px-1.5 bg-background border-border"
                                placeholder="Custom client..."
                                value={row.client || ""}
                                onChange={(e) => updateGridRow(row.id, "client", e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                title="Select from list"
                                onClick={() => updateGridRow(row.id, "isCustomClient", false)}
                                className="text-[10px] text-primary hover:underline shrink-0"
                              >
                                📋
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <Select
                                value={row.client || NONE}
                                onValueChange={(v) => {
                                  if (v === "__CUSTOM__") {
                                    updateGridRow(row.id, "isCustomClient", true);
                                  } else {
                                    updateGridRow(row.id, "client", v === NONE ? "" : v);
                                  }
                                }}
                              >
                                <SelectTrigger className="h-7 text-[11px] px-1.5 bg-background border-border">
                                  <SelectValue placeholder="Client..." />
                                </SelectTrigger>
                                <SelectContent className="max-h-60 overflow-y-auto">
                                  <SelectItem value="__CUSTOM__" className="text-primary font-semibold border-b border-border pb-1 mb-1">
                                    ✏️ + Type custom client name...
                                  </SelectItem>
                                  <SelectItem value={NONE}>None</SelectItem>
                                  {uniqueClients.map((c: string, idx: number) => (
                                    <SelectItem key={`gc-${row.id}-${c || 'blank'}-${idx}`} value={c || NONE}>
                                      {c}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <button
                                type="button"
                                title="Type custom client"
                                onClick={() => updateGridRow(row.id, "isCustomClient", true)}
                                className="text-[10px] text-muted-foreground hover:text-primary shrink-0 px-0.5"
                              >
                                ✏️
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          {row.isCustomProj ? (
                            <div className="flex items-center gap-1">
                              <Input
                                className="h-7 text-[11px] px-1.5 bg-background border-border"
                                placeholder="Custom project..."
                                value={row.project_name || ""}
                                onChange={(e) => updateGridRow(row.id, "project_name", e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                title="Select from list"
                                onClick={() => updateGridRow(row.id, "isCustomProj", false)}
                                className="text-[10px] text-primary hover:underline shrink-0"
                              >
                                📋
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <Select
                                value={row.project_name || NONE}
                                onValueChange={(v) => {
                                  if (v === "__CUSTOM__") {
                                    updateGridRow(row.id, "isCustomProj", true);
                                  } else {
                                    const projName = v === NONE ? "" : v;
                                    const match = projects.find((p) => p.name === projName);
                                    updateGridRow(row.id, "project_name", projName);
                                    if (match?.client) {
                                      updateGridRow(row.id, "client", match.client);
                                    }
                                  }
                                }}
                              >
                                <SelectTrigger className="h-7 text-[11px] px-1.5 bg-background border-border">
                                  <SelectValue placeholder="Project..." />
                                </SelectTrigger>
                                <SelectContent className="max-h-60 overflow-y-auto">
                                  <SelectItem value="__CUSTOM__" className="text-primary font-semibold border-b border-border pb-1 mb-1">
                                    ✏️ + Type custom project name...
                                  </SelectItem>
                                  <SelectItem value={NONE}>None</SelectItem>
                                  {projects.map((p, idx) => (
                                    <SelectItem key={`gp-${row.id}-${p.id || 'typed'}-${p.name}-${idx}`} value={p.name}>
                                      {p.client ? `${p.name} (${p.client})` : p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <button
                                type="button"
                                title="Type custom project"
                                onClick={() => updateGridRow(row.id, "isCustomProj", true)}
                                className="text-[10px] text-muted-foreground hover:text-primary shrink-0 px-0.5"
                              >
                                ✏️
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Select
                            value={row.priority}
                            onValueChange={(v) =>
                              updateGridRow(row.id, "priority", v as Task["priority"])
                            }
                          >
                            <SelectTrigger className="h-7 text-[11px] px-1.5 bg-background border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TASK_PRIORITIES.map((p) => (
                                <SelectItem key={p} value={p}>
                                  {p}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Input
                            type="date"
                            className="h-7 text-[11px] cursor-pointer px-1 bg-background border-border"
                            value={row.start_date ?? ""}
                            onChange={(e) =>
                              updateGridRow(row.id, "start_date", e.target.value || null)
                            }
                          />
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Input
                            type="date"
                            className="h-7 text-[11px] cursor-pointer px-1 bg-background border-border"
                            value={row.due_date ?? ""}
                            onChange={(e) =>
                              updateGridRow(row.id, "due_date", e.target.value || null)
                            }
                          />
                        </td>
                        <td className="py-1 px-1 border-r border-border/40">
                          <Input
                            type="number"
                            step="0.5"
                            className="h-7 text-[11px] px-1 bg-background border-border"
                            value={row.planned_hours || ""}
                            onChange={(e) =>
                              updateGridRow(
                                row.id,
                                "planned_hours",
                                e.target.value ? Number(e.target.value) : 0
                              )
                            }
                          />
                        </td>
                        <td className="py-1 px-1 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeGridRow(row.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs bg-card border-border hover:bg-secondary"
                  onClick={addGridRow}
                >
                  <Plus className="w-3.5 h-3.5 text-primary" />
                  <span>Add Task Row</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={clearGridRows}
                >
                  Clear Grid
                </Button>
              </div>
            </div>
          ) : (
            /* SPLIT 2-COLUMN MODAL LAYOUT */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN: TASK DETAILS & ATTRIBUTES (7 COLUMNS) */}
              <div className="lg:col-span-7 space-y-4">
                {/* Task Title Input Section */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Task Title <span className="text-destructive">*</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">Fill up all information</span>
                  </div>
                  <Input
                    className="text-base font-semibold bg-card border-border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground/50 py-2.5 px-3 rounded-xl"
                    placeholder="Task title (e.g. Filllo Web Design)..."
                    value={form.task_name ?? ""}
                    onChange={(e) => setForm({ ...form, task_name: e.target.value })}
                    autoFocus
                  />
                </div>

                {/* Assignees Section */}
                <div className="space-y-1 bg-card border border-border p-3 rounded-xl">
                  <Label className="text-xs font-medium text-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> Assignees</span>
                    {!initial && creationMode === "bulk_same" && (
                      <span className="text-[10px] text-primary font-semibold">(Multi-Select)</span>
                    )}
                  </Label>

                  {initial || creationMode === "single" ? (
                    <Select
                      value={form.assigned_to ?? NONE}
                      onValueChange={(v) => setForm({ ...form, assigned_to: v === NONE ? null : v })}
                    >
                      <SelectTrigger className="h-9 text-xs bg-background border-border text-foreground">
                        <SelectValue placeholder="Search or select a person..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Unassigned</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          type="button"
                          className="w-full justify-between font-normal px-3 h-9 text-xs bg-background border-border text-foreground"
                        >
                          <span className="truncate">
                            {selectedAssignees.length === 0
                              ? "Search for a person..."
                              : selectedAssignees.length === profiles.length
                              ? "All Team Members"
                              : `${selectedAssignees.length} member${selectedAssignees.length === 1 ? "" : "s"} selected`}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2 bg-card border-border text-foreground" align="start">
                        <div className="flex items-center justify-between border-b border-border pb-2 mb-2 px-1">
                          <span className="text-xs font-semibold text-muted-foreground">Team Members</span>
                          <div className="flex items-center gap-1">
                            <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={selectAllAssignees}>Select All</Button>
                            <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-1.5 text-muted-foreground" onClick={clearAllAssignees}>Clear</Button>
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1" onWheel={(e) => e.stopPropagation()}>
                          {profiles.map((p) => {
                            const checked = selectedAssignees.includes(p.id);
                            return (
                              <div
                                key={p.id}
                                className="flex items-center space-x-2 px-2 py-1.5 hover:bg-secondary rounded cursor-pointer text-xs"
                                onClick={() => toggleAssignee(p.id)}
                              >
                                <Checkbox checked={checked} />
                                <span className="flex-1 truncate">{p.display_name}</span>
                              </div>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}

                  {/* Assignee Chips Display */}
                  {!initial && creationMode === "bulk_same" && selectedAssignees.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1.5">
                      {selectedAssignees.map((id) => {
                        const profile = profiles.find((p) => p.id === id);
                        return (
                          <Badge key={id} variant="secondary" className="gap-1 text-[11px] py-0.5 px-2 bg-primary/15 text-primary border-primary/30">
                            <span>{profile?.display_name || id}</span>
                            <X className="w-3 h-3 cursor-pointer hover:text-destructive" onClick={() => toggleAssignee(id)} />
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Fields Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Work Item Type */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Work item type</Label>
                    <Select value={form.type_id ?? ""} onValueChange={(v) => setForm({ ...form, type_id: v || null })}>
                      <SelectTrigger className="h-9 text-xs bg-card border-border">
                        <SelectValue placeholder="Task (default)" />
                      </SelectTrigger>
                      <SelectContent>
                        {types.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={form.status ?? "To Do"} onValueChange={(v) => setForm({ ...form, status: v as Task["status"] })}>
                      <SelectTrigger className="h-9 text-xs bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Priority</Label>
                    <Select value={form.priority ?? "Medium"} onValueChange={(v) => setForm({ ...form, priority: v as Task["priority"] })}>
                      <SelectTrigger className="h-9 text-xs bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Reviewer */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Reviewer</Label>
                    <Select value={form.reviewer ?? NONE} onValueChange={(v) => setForm({ ...form, reviewer: v === NONE ? null : v })}>
                      <SelectTrigger className="h-9 text-xs bg-card border-border">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Project Field (Select or Type Custom) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs text-muted-foreground">Project</Label>
                      <button
                        type="button"
                        onClick={() => setIsCustomProject(!isCustomProject)}
                        className="text-[10px] text-primary hover:underline font-medium"
                      >
                        {isCustomProject ? "📋 Select from list" : "✏️ Type custom project"}
                      </button>
                    </div>

                    {isCustomProject ? (
                      <Input
                        className="h-9 text-xs bg-card border-border text-foreground"
                        placeholder="Type custom project name..."
                        value={form.project_name ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            project_name: e.target.value,
                          }))
                        }
                      />
                    ) : (
                      <Select
                        value={form.project_name || NONE}
                        onValueChange={(val) => {
                          if (val === "__CUSTOM__") {
                            setIsCustomProject(true);
                            return;
                          }
                          const projName = val === NONE ? "" : val;
                          const match = projects.find((p) => p.name === projName);
                          setForm((prev) => ({
                            ...prev,
                            project_name: projName,
                            project_id: match ? match.id : prev.project_id,
                            client: match?.client ? match.client : prev.client,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-9 text-xs bg-card border-border text-foreground">
                          <SelectValue placeholder="Select project..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          <SelectItem value="__CUSTOM__" className="text-primary font-semibold border-b border-border pb-1 mb-1">
                            ✏️ + Type custom project name...
                          </SelectItem>
                          <SelectItem value={NONE}>None (No Project)</SelectItem>
                          {projects.map((p, idx) => (
                            <SelectItem key={`proj-${p.id || 'typed'}-${p.name}-${idx}`} value={p.name}>
                              {p.client ? `${p.name} (${p.client})` : p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Client Field (Select or Type Custom) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs text-muted-foreground">Client</Label>
                      <button
                        type="button"
                        onClick={() => setIsCustomClient(!isCustomClient)}
                        className="text-[10px] text-primary hover:underline font-medium"
                      >
                        {isCustomClient ? "📋 Select from list" : "✏️ Type custom client"}
                      </button>
                    </div>

                    {isCustomClient ? (
                      <Input
                        className="h-9 text-xs bg-card border-border text-foreground"
                        placeholder="Type custom client name..."
                        value={form.client ?? ""}
                        onChange={(e) => setForm({ ...form, client: e.target.value })}
                      />
                    ) : (
                      <Select
                        value={form.client || NONE}
                        onValueChange={(val) => {
                          if (val === "__CUSTOM__") {
                            setIsCustomClient(true);
                            return;
                          }
                          setForm({ ...form, client: val === NONE ? "" : val });
                        }}
                      >
                        <SelectTrigger className="h-9 text-xs bg-card border-border text-foreground">
                          <SelectValue placeholder="Select client..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          <SelectItem value="__CUSTOM__" className="text-primary font-semibold border-b border-border pb-1 mb-1">
                            ✏️ + Type custom client name...
                          </SelectItem>
                          <SelectItem value={NONE}>None (No Client)</SelectItem>
                          {uniqueClients.map((c: string, idx: number) => (
                            <SelectItem key={`client-${c || 'blank'}-${idx}`} value={c || NONE}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Start Date & Due Date Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Start Date</Label>
                      <Input
                        type="date"
                        className="h-9 text-xs bg-card border-border cursor-pointer"
                        value={form.start_date ?? ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setForm((prev) => {
                            const newCustom = { ...(prev.custom_fields || {}) };
                            delete newCustom.start_date;
                            return {
                              ...prev,
                              start_date: val,
                              custom_fields: newCustom,
                            };
                          });
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Due Date</Label>
                      <Input
                        type="date"
                        className="h-9 text-xs bg-card border-border cursor-pointer"
                        value={form.due_date ?? ""}
                        onChange={(e) => setForm({ ...form, due_date: e.target.value || null })}
                      />
                      {form.due_date && (() => {
                        const holiday = getLocalHoliday(form.due_date, apiHolidays);
                        if (holiday) {
                          return (
                            <div className="mt-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded flex items-center gap-1 border border-amber-500/20">
                              <span>{holiday.emoji}</span>
                              <span>Holiday ({holiday.name})</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>

                  {/* Planned Hours & Sprint */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Planned Hrs</Label>
                      <Input
                        type="number"
                        step="0.5"
                        className="h-9 text-xs bg-card border-border"
                        value={form.planned_hours ?? ""}
                        onChange={(e) => setForm({ ...form, planned_hours: e.target.value ? Number(e.target.value) : 0 })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Sprint / Week</Label>
                      <Input
                        className="h-9 text-xs bg-card border-border"
                        value={form.sprint_week ?? ""}
                        onChange={(e) => setForm({ ...form, sprint_week: e.target.value })}
                        placeholder="W21"
                      />
                    </div>
                  </div>
                </div>

                {/* Time Tracking Progress Bar */}
                {form.planned_hours ? (
                  <div className="space-y-1.5 bg-card border border-border p-3 rounded-xl">
                    <div className="flex items-center justify-between text-xs text-foreground">
                      <span className="font-semibold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /> Time Tracking</span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {form.actual_hours || 0}h logged / {form.planned_hours}h planned
                      </span>
                    </div>
                    <div className="h-2.5 w-full bg-secondary rounded-full overflow-hidden flex border border-border">
                      <div
                        className="bg-gradient-to-r from-primary to-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.round(((form.actual_hours || 0) / form.planned_hours) * 100))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                      <span>{form.actual_hours || 0}h completed</span>
                      <span>{Math.max(0, (form.planned_hours || 0) - (form.actual_hours || 0))}h remaining</span>
                    </div>
                  </div>
                ) : null}

                {/* Remarks / Notes */}
                <div>
                  <Label className="text-xs text-muted-foreground">Remarks / Description</Label>
                  <Textarea
                    className="bg-card border-border text-xs text-foreground rounded-xl"
                    value={form.remarks ?? ""}
                    onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                    rows={3}
                    placeholder="Task details, instructions, or notes..."
                  />
                </div>

                {/* Custom Dynamic Fields */}
                <DynamicFieldsForm
                  defs={fieldDefs}
                  values={(form.custom_fields ?? {}) as Record<string, unknown>}
                  onChange={(next) => setForm({ ...form, custom_fields: next })}
                  workItemId={initial?.id ?? form.id ?? null}
                />
              </div>

              {/* RIGHT COLUMN: INTERACTIVE TABS PANEL (5 COLUMNS WITH LEFT BORDER) */}
              <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-border pt-4 lg:pt-0 lg:pl-5 space-y-3 flex flex-col min-h-[380px]">
                <Tabs defaultValue="comments" className="flex-1 flex flex-col">
                  <TabsList className="grid grid-cols-3 bg-card border border-border p-1 h-auto rounded-xl">
                    <TabsTrigger value="comments" className="text-xs gap-1 py-1.5 text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      <MessageSquare className="w-3.5 h-3.5" /> Comments
                    </TabsTrigger>
                    <TabsTrigger value="files" className="text-xs gap-1 py-1.5 text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      <Paperclip className="w-3.5 h-3.5" /> Files
                    </TabsTrigger>
                    <TabsTrigger value="history" className="text-xs gap-1 py-1.5 text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      <Activity className="w-3.5 h-3.5" /> History
                    </TabsTrigger>
                  </TabsList>

                  {/* TAB 1: COMMENTS PANEL */}
                  <TabsContent value="comments" className="flex-1 mt-3 space-y-3">
                    {initial?.id ? (
                      <CommentsPanel workItemId={initial.id} userId={userId} profiles={profiles} canModerate={true} />
                    ) : (
                      <div className="bg-card border border-border rounded-xl p-4 text-center space-y-2 text-muted-foreground my-auto">
                        <MessageSquare className="w-8 h-8 text-primary mx-auto opacity-80" />
                        <h4 className="text-xs font-semibold text-foreground">Task Chat & Comments</h4>
                        <p className="text-[11px]">Save task first to start discussions and tag team members with @mentions.</p>
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 2: ATTACHMENTS PANEL */}
                  <TabsContent value="files" className="flex-1 mt-3 space-y-3">
                    {initial?.id ? (
                      <AttachmentsPanel workItemId={initial.id} userId={userId} canDeleteAny={true} />
                    ) : (
                      <div className="bg-card border border-border rounded-xl p-4 text-center space-y-2 text-muted-foreground my-auto">
                        <Paperclip className="w-8 h-8 text-amber-400 mx-auto opacity-80" />
                        <h4 className="text-xs font-semibold text-foreground">Task File Attachments</h4>
                        <p className="text-[11px]">Save task first to upload design files, documents, and media.</p>
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 3: ACTIVITY HISTORY */}
                  <TabsContent value="history" className="flex-1 mt-3 space-y-2">
                    <div className="bg-card border border-border rounded-xl p-3 max-h-72 overflow-y-auto space-y-2">
                      {taskHistoryItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic text-center py-4">No recent status activity.</p>
                      ) : (
                        taskHistoryItems.map((h) => {
                          const actor = profiles.find((p) => p.id === h.updated_by);
                          return (
                            <div key={h.id} className="text-xs p-2 rounded-lg bg-secondary border border-border space-y-1">
                              <div className="flex items-center justify-between text-muted-foreground text-[10px]">
                                <span className="font-semibold text-foreground">{actor?.display_name || "System"}</span>
                                <span>{formatRelative(h.created_at)}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-foreground">
                                <Badge variant="outline" className="text-[10px]">{h.old_status || "Created"}</Badge>
                                <ArrowRightCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                                <Badge variant="secondary" className="text-[10px] bg-primary/20 text-primary">{h.new_status}</Badge>
                              </div>
                              {h.comment && <p className="text-[11px] text-muted-foreground italic">"{h.comment}"</p>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          )}
        </div>

        {/* Dialog Footer Actions (Fixed at Bottom, Always Visible) */}
        <DialogFooter className="shrink-0 p-4 border-t border-border bg-card flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving} className="text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md px-5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {initial
                ? "Save Changes"
                : creationMode === "grid"
                ? `Create ${validGridRowCount} Task${validGridRowCount === 1 ? "" : "s"}`
                : creationMode === "bulk_same" && selectedAssignees.length > 1
                ? `Create ${selectedAssignees.length} Tasks`
                : "Create Task"}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
