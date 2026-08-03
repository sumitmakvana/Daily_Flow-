import { useEffect, useState } from "react";
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
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task, type WorkItemType } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getLocalHoliday, fetchIndianHolidays, type Holiday } from "@/lib/format";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { workItemTypesService } from "@/services/work-item-types";
import { dynamicFieldsService, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { DynamicFieldsForm } from "@/components/DynamicFieldsForm";
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
} from "lucide-react";

const NONE = "__none";

type CreationMode = "single" | "bulk_same" | "grid";

interface GridRow {
  id: string;
  task_name: string;
  assigned_to: string | null;
  type_id: string | null;
  client: string;
  project_name: string;
  priority: Task["priority"];
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
  const [form, setForm] = useState<Partial<Task>>(
    initial ?? { priority: "Medium", status: "To Do", custom_fields: {} }
  );
  const [fieldDefs, setFieldDefs] = useState<WorkItemFieldDef[]>([]);
  const [apiHolidays, setApiHolidays] = useState<Record<string, Holiday>>({});

  // Creation Mode State (Only active for New Task)
  const [creationMode, setCreationMode] = useState<CreationMode>("single");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Multi-Task Grid State
  const [gridRows, setGridRows] = useState<GridRow[]>([
    { id: "1", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
    { id: "2", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
    { id: "3", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
  ]);

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
      setForm(initial ?? { priority: "Medium", status: "To Do", custom_fields: {} });
      setCreationMode("single");
      setSelectedAssignees(initial?.assigned_to ? [initial.assigned_to] : []);
      setGridRows([
        { id: "1", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
        { id: "2", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
        { id: "3", task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
      ]);
    }
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
  }, [open]);

  // Load field defs for the currently-selected type
  useEffect(() => {
    if (!open) return;
    if (!form.type_id) {
      setFieldDefs([]);
      return;
    }
    dynamicFieldsService.listDefs(form.type_id).then(setFieldDefs).catch(() => setFieldDefs([]));
  }, [open, form.type_id]);

  // Clean up custom_fields
  useEffect(() => {
    if (!open) return;
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
      { id: String(Date.now()), task_name: "", assigned_to: null, type_id: null, client: "", project_name: "", priority: "Medium", due_date: null, planned_hours: 0 },
    ]);
  };

  // Main Save Handler
  const handleSave = async () => {
    // 1. Edit existing task
    if (initial?.id) {
      if (!form.task_name?.trim()) {
        toast.error("Task name required");
        return;
      }
      const validation = dynamicFieldsService.validate(
        fieldDefs,
        (form.custom_fields ?? {}) as Record<string, unknown>
      );
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

    // 3. New Task: Bulk Assign (Same Task to Multiple Team Members) Mode
    if (creationMode === "bulk_same") {
      if (!form.task_name?.trim()) {
        toast.error("Task name required");
        return;
      }
      const validation = dynamicFieldsService.validate(
        fieldDefs,
        (form.custom_fields ?? {}) as Record<string, unknown>
      );
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
    const validation = dynamicFieldsService.validate(
      fieldDefs,
      (form.custom_fields ?? {}) as Record<string, unknown>
    );
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

  const getDialogTitle = () => {
    if (initial) return "Edit task";
    if (creationMode === "single") return "New task";
    if (creationMode === "bulk_same") return "Bulk Assign Task (Same Task to Team)";
    return "Multi-Task Quick Creation";
  };

  const validGridRowCount = gridRows.filter((r) => r.task_name.trim().length > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[92vh] overflow-y-auto transition-all p-4 md:p-6",
          creationMode === "grid" && !initial
            ? "sm:max-w-6xl w-[96vw]"
            : "sm:max-w-lg w-full"
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-base md:text-lg">
            <span>{getDialogTitle()}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Mode Switcher Tabs (Only for New Task creation) */}
        {!initial && (
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg text-xs font-medium mb-1 overflow-x-auto">
            <button
              type="button"
              className={cn(
                "flex-1 py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
                creationMode === "single"
                  ? "bg-background text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setCreationMode("single")}
            >
              <User className="w-3.5 h-3.5" />
              <span>Single Task</span>
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
                creationMode === "bulk_same"
                  ? "bg-background text-primary shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setCreationMode("bulk_same")}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Bulk Assign (Same)</span>
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
                creationMode === "grid"
                  ? "bg-background text-blue-600 dark:text-blue-400 shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setCreationMode("grid")}
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>Multi-Task Grid</span>
            </button>
          </div>
        )}

        {/* MODE 3: MULTI-TASK GRID VIEW */}
        {!initial && creationMode === "grid" ? (
          <div className="space-y-3">
            <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-lg text-xs text-blue-700 dark:text-blue-300 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>
                  Each task row has its own <strong>Task Name, Assignee, Work Item Type, Client & Project</strong>.
                </span>
              </div>
              <Badge variant="secondary" className="bg-blue-500/20 text-blue-800 dark:text-blue-200">
                {validGridRowCount} task{validGridRowCount === 1 ? "" : "s"} ready
              </Badge>
            </div>

            {/* Grid Table Container with Responsive Horizontal & Vertical Scroll */}
            <div className="border rounded-xl overflow-x-auto max-h-[55vh] overflow-y-auto bg-background shadow-sm">
              <table className="w-full text-xs text-left border-collapse min-w-[1000px]">
                <thead className="sticky top-0 bg-muted z-10 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold border-b shadow-xs">
                  <tr>
                    <th className="py-2.5 px-2 text-center w-8 bg-muted">#</th>
                    <th className="py-2.5 px-3 min-w-[180px] bg-muted">Task Name *</th>
                    <th className="py-2.5 px-3 min-w-[140px] bg-muted">Assigned To</th>
                    <th className="py-2.5 px-3 min-w-[130px] bg-muted">Work Type</th>
                    <th className="py-2.5 px-3 min-w-[120px] bg-muted">Client</th>
                    <th className="py-2.5 px-3 min-w-[120px] bg-muted">Project</th>
                    <th className="py-2.5 px-3 w-[100px] bg-muted">Priority</th>
                    <th className="py-2.5 px-3 w-[130px] bg-muted">Due Date</th>
                    <th className="py-2.5 px-3 w-[70px] bg-muted">Hrs</th>
                    <th className="py-2.5 px-2 text-center w-10 bg-muted"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {gridRows.map((row, index) => (
                    <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-2 text-center text-muted-foreground font-mono">
                        {index + 1}
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          className="h-8 text-xs focus:ring-1"
                          placeholder="Task title..."
                          value={row.task_name}
                          onChange={(e) => updateGridRow(row.id, "task_name", e.target.value)}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Select
                          value={row.assigned_to ?? NONE}
                          onValueChange={(v) =>
                            updateGridRow(row.id, "assigned_to", v === NONE ? null : v)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
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
                      <td className="py-1.5 px-2">
                        <Select
                          value={row.type_id ?? NONE}
                          onValueChange={(v) =>
                            updateGridRow(row.id, "type_id", v === NONE ? null : v)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Task (default)" />
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
                      <td className="py-1.5 px-2">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Client..."
                          value={row.client}
                          onChange={(e) => updateGridRow(row.id, "client", e.target.value)}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Project..."
                          value={row.project_name}
                          onChange={(e) => updateGridRow(row.id, "project_name", e.target.value)}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Select
                          value={row.priority}
                          onValueChange={(v) =>
                            updateGridRow(row.id, "priority", v as Task["priority"])
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
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
                      <td className="py-1.5 px-2">
                        <Input
                          type="date"
                          className="h-8 text-xs cursor-pointer px-2"
                          value={row.due_date ?? ""}
                          onChange={(e) =>
                            updateGridRow(row.id, "due_date", e.target.value || null)
                          }
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          step="0.5"
                          className="h-8 text-xs px-2"
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
                      <td className="py-1.5 px-2 text-center">
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
                className="gap-1.5 text-xs shadow-2xs"
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
          /* MODE 1 & 2: STANDARD / BULK ASSIGN FORM */
          <div className="space-y-3">
            <div>
              <Label>
                Task name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.task_name ?? ""}
                onChange={(e) => setForm({ ...form, task_name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <Label>Work item type</Label>
              <Select
                value={form.type_id ?? ""}
                onValueChange={(v) => setForm({ ...form, type_id: v || null })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Task (default)" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Client</Label>
                <Input
                  value={form.client ?? ""}
                  onChange={(e) => setForm({ ...form, client: e.target.value })}
                />
              </div>
              <div>
                <Label>Project</Label>
                <Input
                  value={form.project_name ?? ""}
                  onChange={(e) => setForm({ ...form, project_name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select
                  value={form.priority ?? "Medium"}
                  onValueChange={(v) => setForm({ ...form, priority: v as Task["priority"] })}
                >
                  <SelectTrigger>
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
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={form.status ?? "To Do"}
                  onValueChange={(v) => setForm({ ...form, status: v as Task["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ASSIGNED TO & REVIEWER SECTION */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center justify-between">
                  <span>Assigned to</span>
                  {!initial && creationMode === "bulk_same" && (
                    <span className="text-[10px] text-primary font-semibold">
                      (Multi-Select)
                    </span>
                  )}
                </Label>

                {/* SINGLE MODE OR EDIT MODE */}
                {initial || creationMode === "single" ? (
                  <Select
                    value={form.assigned_to ?? NONE}
                    onValueChange={(v) =>
                      setForm({ ...form, assigned_to: v === NONE ? null : v })
                    }
                  >
                    <SelectTrigger>
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
                ) : (
                  /* BULK SAME TASK MODE: MULTI-SELECT POPOVER */
                  <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        type="button"
                        className="w-full justify-between font-normal px-3"
                      >
                        <span className="truncate">
                          {selectedAssignees.length === 0
                            ? "Select team members..."
                            : selectedAssignees.length === profiles.length
                            ? "All Team Members"
                            : `${selectedAssignees.length} member${
                                selectedAssignees.length === 1 ? "" : "s"
                              } selected`}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="start">
                      <div className="flex items-center justify-between border-b pb-2 mb-2 px-1">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Team Members
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-1.5"
                            onClick={selectAllAssignees}
                          >
                            Select All
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-1.5 text-muted-foreground"
                            onClick={clearAllAssignees}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                      <div
                        className="max-h-48 overflow-y-auto space-y-1"
                        onWheel={(e) => e.stopPropagation()}
                      >
                        {profiles.map((p) => {
                          const checked = selectedAssignees.includes(p.id);
                          return (
                            <div
                              key={p.id}
                              className="flex items-center space-x-2 px-2 py-1.5 hover:bg-muted/50 rounded cursor-pointer text-xs"
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
              </div>

              <div>
                <Label>Reviewer</Label>
                <Select
                  value={form.reviewer ?? NONE}
                  onValueChange={(v) => setForm({ ...form, reviewer: v === NONE ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Selected Assignees Badges & Banner in Bulk Same Mode */}
            {!initial && creationMode === "bulk_same" && (
              <div className="space-y-2 pt-1">
                {selectedAssignees.length > 0 ? (
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1.5 bg-muted/20 rounded-md border">
                    {selectedAssignees.map((id) => {
                      const profile = profiles.find((p) => p.id === id);
                      return (
                        <Badge
                          key={id}
                          variant="secondary"
                          className="gap-1 text-xs py-0.5 px-2 bg-primary/10 text-primary border-primary/20"
                        >
                          <span>{profile?.display_name || id}</span>
                          <X
                            className="w-3 h-3 cursor-pointer hover:text-destructive"
                            onClick={() => toggleAssignee(id)}
                          />
                        </Badge>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-600 font-medium">
                    ⚠️ No team member selected. (Will create 1 unassigned task).
                  </p>
                )}

                {selectedAssignees.length > 1 && (
                  <div className="bg-primary/10 text-primary border border-primary/20 p-2.5 rounded-lg text-xs font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>
                      Will create <strong>{selectedAssignees.length} individual tasks</strong> (1 for each selected member).
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.due_date ?? ""}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value || null })}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (err) {}
                  }}
                  className="cursor-pointer"
                />
                {form.due_date && (() => {
                  const holiday = getLocalHoliday(form.due_date, apiHolidays);
                  if (holiday) {
                    return (
                      <div className="mt-1 text-[10px] font-medium text-amber-600 bg-amber-500/10 px-2 py-1 rounded flex items-center gap-1">
                        <span>{holiday.emoji}</span>
                        <span>Note: Selected date is a holiday ({holiday.name})</span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              <div>
                <Label>Planned hrs</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.planned_hours ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, planned_hours: e.target.value ? Number(e.target.value) : 0 })
                  }
                />
              </div>
              <div>
                <Label>Sprint / week</Label>
                <Input
                  value={form.sprint_week ?? ""}
                  onChange={(e) => setForm({ ...form, sprint_week: e.target.value })}
                  placeholder="W21"
                />
              </div>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={form.remarks ?? ""}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                rows={2}
              />
            </div>
            <DynamicFieldsForm
              defs={fieldDefs}
              values={(form.custom_fields ?? {}) as Record<string, unknown>}
              onChange={(next) => setForm({ ...form, custom_fields: next })}
              workItemId={initial?.id ?? form.id ?? null}
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {initial
                ? "Save"
                : creationMode === "grid"
                ? `Create ${validGridRowCount} Task${validGridRowCount === 1 ? "" : "s"}`
                : creationMode === "bulk_same" && selectedAssignees.length > 1
                ? `Create ${selectedAssignees.length} Tasks`
                : "Create"}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
