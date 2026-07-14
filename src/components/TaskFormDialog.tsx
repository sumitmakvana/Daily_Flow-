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
import { tasksService, TaskConflictError } from "@/services/tasks";
import { workItemTypesService } from "@/services/work-item-types";
import { dynamicFieldsService, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { DynamicFieldsForm } from "@/components/DynamicFieldsForm";

const NONE = "__none";

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
  const [form, setForm] = useState<Partial<Task>>(initial ?? { priority: "Medium", status: "To Do", custom_fields: {} });
  const [fieldDefs, setFieldDefs] = useState<WorkItemFieldDef[]>([]);

  useEffect(() => {
    setForm(initial ?? { priority: "Medium", status: "To Do", custom_fields: {} });
  }, [initial, open]);

  useEffect(() => {
    if (!open) return;
    supabase.from("profiles").select("id,display_name,avatar_url").then(({ data }) => {
      setProfiles((data ?? []) as Profile[]);
    });
    workItemTypesService.list().then(setTypes).catch(() => setTypes([]));
  }, [open]);

  // Load field defs for the currently-selected type
  useEffect(() => {
    if (!open) return;
    if (!form.type_id) { setFieldDefs([]); return; }
    dynamicFieldsService.listDefs(form.type_id).then(setFieldDefs).catch(() => setFieldDefs([]));
  }, [open, form.type_id]);

  // Clean up any custom_fields values that are not in the new fieldDefs to prevent "Unknown field" errors
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

  const handleSave = async () => {
    if (!form.task_name?.trim()) {
      toast.error("Task name required");
      return;
    }
    // Validate custom fields against active defs
    const validation = dynamicFieldsService.validate(fieldDefs, (form.custom_fields ?? {}) as Record<string, unknown>);
    if (!validation.ok) { toast.error(validation.errors[0]); return; }
    try {
      if (initial?.id) {
        await tasksService.update(initial, form, userId);
        toast.success("Task updated");
      } else {
        await tasksService.create(form, userId);
        toast.success("Task created");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      if (e instanceof TaskConflictError) {
        toast.error(e.message);
        onSaved();
      } else {
        toast.error((e as Error).message);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Task name</Label>
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
              <SelectTrigger><SelectValue placeholder="Task (default)" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Client</Label>
              <Input value={form.client ?? ""} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </div>
            <div>
              <Label>Project</Label>
              <Input value={form.project_name ?? ""} onChange={(e) => setForm({ ...form, project_name: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Select value={form.priority ?? "Medium"} onValueChange={(v) => setForm({ ...form, priority: v as Task["priority"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status ?? "To Do"} onValueChange={(v) => setForm({ ...form, status: v as Task["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Assigned to</Label>
              <Select
                value={form.assigned_to ?? NONE}
                onValueChange={(v) => setForm({ ...form, assigned_to: v === NONE ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reviewer</Label>
              <Select
                value={form.reviewer ?? NONE}
                onValueChange={(v) => setForm({ ...form, reviewer: v === NONE ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Due date</Label>
              <Input
                type="date"
                value={form.due_date ?? ""}
                onChange={(e) => setForm({ ...form, due_date: e.target.value || null })}
              />
            </div>
            <div>
              <Label>Planned hrs</Label>
              <Input
                type="number"
                step="0.5"
                value={form.planned_hours ?? ""}
                onChange={(e) => setForm({ ...form, planned_hours: e.target.value ? Number(e.target.value) : 0 })}
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
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>{initial ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
