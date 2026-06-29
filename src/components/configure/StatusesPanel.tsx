import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { workItemTypesService } from "@/services/work-item-types";
import { workflowService, type WorkItemStatus } from "@/services/workflow";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItemType } from "@/lib/types";
import { TypeSelector } from "./TypeSelector";
import { toast } from "sonner";
import { toKey, isValidKey } from "@/lib/slug";
import { Plus, Pencil, Trash2 } from "lucide-react";

const CATEGORIES = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export function StatusesPanel() {
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<WorkItemStatus[]>([]);
  const [editing, setEditing] = useState<WorkItemStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    workItemTypesService.list(true).then((ts) => { setTypes(ts); if (!typeId && ts[0]) setTypeId(ts[0].id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!typeId) return;
    try { setStatuses(await workflowService.listStatuses(typeId)); }
    catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [typeId]);

  const remove = async (s: WorkItemStatus) => {
    if (!confirm(`Delete status "${s.label}"?`)) return;
    const { error } = await supabase.from("work_item_statuses").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Statuses</h2>
          <p className="text-xs text-muted-foreground">Define the lifecycle states for each work item type.</p>
        </div>
        <div className="flex items-center gap-2">
          <TypeSelector types={types} value={typeId} onChange={setTypeId} />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!typeId} onClick={() => setEditing(null)}><Plus className="h-3 w-3 mr-1" />New Status</Button>
            </DialogTrigger>
            <StatusFormDialog editing={editing} typeId={typeId} onSaved={() => { setOpen(false); setEditing(null); load(); }} />
          </Dialog>
        </div>
      </div>
      <div className="space-y-1">
        {statuses.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-border/40 py-2 last:border-0">
            <div className="w-2 h-2 rounded-full" style={{ background: s.color ?? "#94a3b8" }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{s.label} <span className="text-xs text-muted-foreground">({s.key})</span></div>
              <div className="text-xs text-muted-foreground">
                {CATEGORIES.find((c) => c.value === s.category)?.label}
                {s.is_initial && " · initial"}
                {s.is_terminal && " · terminal"}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
            <Button variant="ghost" size="sm" onClick={() => remove(s)}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
        {statuses.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No statuses yet for this type.</p>}
      </div>
    </Card>
  );
}

function StatusFormDialog({ editing, typeId, onSaved }: { editing: WorkItemStatus | null; typeId: string | null; onSaved: () => void }) {
  const [form, setForm] = useState({
    key: editing?.key ?? "",
    keyEdited: !!editing,
    label: editing?.label ?? "",
    category: editing?.category ?? "todo",
    color: editing?.color ?? "#94a3b8",
    sort_order: editing?.sort_order ?? 100,
    is_initial: editing?.is_initial ?? false,
    is_terminal: editing?.is_terminal ?? false,
  });

  const onLabelChange = (label: string) => {
    setForm((f) => ({ ...f, label, key: f.keyEdited ? f.key : toKey(label) }));
  };

  const save = async () => {
    if (!typeId) return;
    if (!form.label) return toast.error("Label required");
    if (!isValidKey(form.key)) return toast.error("Invalid internal key");
    const { keyEdited: _ke, ...row } = form;
    const payload = { ...row, type_id: typeId };
    const { error } = editing
      ? await supabase.from("work_item_statuses").update(row as never).eq("id", editing.id)
      : await supabase.from("work_item_statuses").insert(payload as never);
    if (error) return toast.error(error.message);
    toast.success("Saved"); onSaved();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Status</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Label</Label>
          <Input value={form.label} onChange={(e) => onLabelChange(e.target.value)} placeholder="e.g. In Progress" autoFocus />
          {form.key && <p className="text-[10px] text-muted-foreground mt-1">Internal key: <code>{form.key}</code></p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as typeof form.category })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Color</Label><Input type="color" value={form.color ?? "#94a3b8"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9" /></div>
        </div>
        <div className="grid grid-cols-3 gap-2 items-end">
          <div><Label>Sort order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_initial} onCheckedChange={(v) => setForm({ ...form, is_initial: v })} />Initial</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_terminal} onCheckedChange={(v) => setForm({ ...form, is_terminal: v })} />Terminal</label>
        </div>
      </div>
      <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
    </DialogContent>
  );
}
