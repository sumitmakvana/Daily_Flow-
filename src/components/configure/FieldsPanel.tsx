import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { workItemTypesService } from "@/services/work-item-types";
import { dynamicFieldsService, normalizeOptions, type FieldDataType, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItemType } from "@/lib/types";
import { TypeSelector } from "./TypeSelector";
import { TagInput } from "./TagInput";
import { toKey, isValidKey } from "@/lib/slug";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";

const TYPE_LABELS: Record<FieldDataType, string> = {
  text: "Short text", number: "Number", date: "Date", datetime: "Date & time",
  boolean: "Yes / No", select: "Single choice", multiselect: "Multiple choice",
  user: "Person", url: "Link", email: "Email",
  photo: "Photo (camera)", geo: "Location (GPS)", photo_geo: "Photo + location", signature: "Signature",
};

export function FieldsPanel() {
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [defs, setDefs] = useState<WorkItemFieldDef[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<WorkItemFieldDef | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    workItemTypesService.list(true).then((ts) => { setTypes(ts); if (!typeId && ts[0]) setTypeId(ts[0].id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!typeId) return;
    // direct query so we can include archived
    const { data, error } = await supabase
      .from("work_item_field_defs").select("*").eq("type_id", typeId).order("sort_order");
    if (error) return toast.error(error.message);
    setDefs((data ?? []) as unknown as WorkItemFieldDef[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [typeId]);

  const archive = async (d: WorkItemFieldDef, next: boolean) => {
    const { error } = await supabase.from("work_item_field_defs").update({ is_active: next } as never).eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success(next ? "Restored" : "Archived");
    load();
  };

  const visible = defs.filter((d) => showArchived || d.is_active);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Custom Fields</h2>
          <p className="text-xs text-muted-foreground">Capture data unique to this work item type — values stored alongside each item.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground"><Switch checked={showArchived} onCheckedChange={setShowArchived} />Archived</label>
          <TypeSelector types={types} value={typeId} onChange={setTypeId} />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!typeId} onClick={() => setEditing(null)}><Plus className="h-3 w-3 mr-1" />New Field</Button>
            </DialogTrigger>
            <FieldFormDialog editing={editing} typeId={typeId} onSaved={() => { setOpen(false); setEditing(null); load(); }} />
          </Dialog>
        </div>
      </div>
      <div className="space-y-1">
        {visible.map((d) => (
          <div key={d.id} className={`flex items-center gap-3 border-b border-border/40 py-2 last:border-0 ${!d.is_active ? "opacity-50" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                {d.label}
                {d.required && <Badge variant="outline" className="text-[10px] h-4">required</Badge>}
                {!d.is_active && <Badge variant="secondary" className="text-[10px] h-4">archived</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{TYPE_LABELS[d.data_type] ?? d.data_type}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
            <Button variant="ghost" size="sm" onClick={() => archive(d, !d.is_active)} title={d.is_active ? "Archive" : "Restore"}>
              {d.is_active ? <Archive className="h-3 w-3" /> : <ArchiveRestore className="h-3 w-3" />}
            </Button>
          </div>
        ))}
        {visible.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No fields yet. Click "New Field" to add one.</p>}
      </div>
    </Card>
  );
}

function FieldFormDialog({ editing, typeId, onSaved }: { editing: WorkItemFieldDef | null; typeId: string | null; onSaved: () => void }) {
  const initialOptions = useMemo(() => normalizeOptions(editing?.options).map((o) => o.label), [editing]);
  const [form, setForm] = useState({
    key: editing?.key ?? "",
    keyEdited: !!editing,
    label: editing?.label ?? "",
    data_type: (editing?.data_type ?? "text") as FieldDataType,
    required: editing?.required ?? false,
    required_for_completion: editing?.required_for_completion ?? false,
    sort_order: editing?.sort_order ?? 100,
  });
  const [options, setOptions] = useState<string[]>(initialOptions);

  const onLabelChange = (label: string) => {
    setForm((f) => ({ ...f, label, key: f.keyEdited ? f.key : toKey(label) }));
  };

  const save = async () => {
    if (!typeId) return;
    if (!form.label) return toast.error("Label required");
    if (!isValidKey(form.key)) return toast.error("Invalid key — letters, numbers, underscores only");
    const needsOptions = form.data_type === "select" || form.data_type === "multiselect";
    if (needsOptions && options.length === 0) return toast.error("Add at least one option");
    const opts = options.map((label) => ({ value: toKey(label), label }));
    const payload = {
      type_id: typeId,
      key: form.key, label: form.label, data_type: form.data_type,
      required: form.required, required_for_completion: form.required_for_completion,
      sort_order: form.sort_order, options: needsOptions ? opts : [],
    };
    const { error } = editing
      ? await supabase.from("work_item_field_defs").update({
          label: form.label, data_type: form.data_type, required: form.required,
          required_for_completion: form.required_for_completion,
          sort_order: form.sort_order, options: needsOptions ? opts : [],
        } as never).eq("id", editing.id)
      : await supabase.from("work_item_field_defs").insert(payload as never);
    if (error) return toast.error(error.message);
    toast.success("Saved"); onSaved();
  };

  const needsOptions = form.data_type === "select" || form.data_type === "multiselect";

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Field</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Label</Label>
          <Input value={form.label} onChange={(e) => onLabelChange(e.target.value)} placeholder="e.g. Batch Number" autoFocus />
          {form.key && <p className="text-[10px] text-muted-foreground mt-1">Internal key: <code>{form.key}</code></p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Type</Label>
            <Select value={form.data_type} onValueChange={(v) => setForm({ ...form, data_type: v as FieldDataType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TYPE_LABELS) as FieldDataType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 justify-end">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.required} onCheckedChange={(v) => setForm({ ...form, required: v })} />Required on create</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.required_for_completion} onCheckedChange={(v) => setForm({ ...form, required_for_completion: v })} />Required to complete</label>
          </div>
        </div>
        {needsOptions && (
          <div>
            <Label>Choices</Label>
            <TagInput values={options} onChange={setOptions} placeholder="Add a choice and press Enter" />
            <p className="text-[10px] text-muted-foreground mt-1">Press Enter or comma to add. Click ✕ to remove.</p>
          </div>
        )}
      </div>
      <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
    </DialogContent>
  );
}
