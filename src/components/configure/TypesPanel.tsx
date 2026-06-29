import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { workItemTypesService } from "@/services/work-item-types";
import { workflowService } from "@/services/workflow";
import type { WorkItemType } from "@/lib/types";
import { toKey, isValidKey } from "@/lib/slug";
import { toast } from "sonner";
import { Plus, Pencil, AlertCircle } from "lucide-react";

export function TypesPanel() {
  const [items, setItems] = useState<WorkItemType[]>([]);
  const [warnings, setWarnings] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<WorkItemType | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const list = await workItemTypesService.list(true);
      setItems(list);
      // compute validity per type (initial status + at least one transition)
      const w: Record<string, string[]> = {};
      await Promise.all(list.map(async (t) => {
        const [statuses, transitions] = await Promise.all([
          workflowService.listStatuses(t.id),
          workflowService.listTransitions(t.id),
        ]);
        const issues: string[] = [];
        if (statuses.length === 0) issues.push("No statuses defined");
        else if (!statuses.some((s) => s.is_initial)) issues.push("No initial status");
        if (statuses.length > 1 && transitions.length === 0) issues.push("No workflow transitions");
        w[t.id] = issues;
      }));
      setWarnings(w);
    }
    catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (t: WorkItemType) => {
    try { await workItemTypesService.setActive(t.id, !t.active); toast.success(t.active ? "Disabled" : "Enabled"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Work Item Types</h2>
          <p className="text-xs text-muted-foreground">What kinds of work this organization tracks (e.g. Task, Audit, Visit).</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => setEditing(null)}><Plus className="h-3 w-3 mr-1" />New Type</Button>
          </DialogTrigger>
          <TypeFormDialog editing={editing} onSaved={() => { setOpen(false); setEditing(null); load(); }} />
        </Dialog>
      </div>
      <div className="space-y-1">
        {items.map((t) => {
          const issues = warnings[t.id] ?? [];
          return (
            <div key={t.id} className="flex items-center gap-3 border-b border-border/40 py-2 last:border-0">
              <div className="w-2 h-2 rounded-full" style={{ background: t.color ?? "#94a3b8" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {t.name}
                  {issues.length > 0 && (
                    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/50">
                      <AlertCircle className="h-3 w-3" />
                      {issues[0]}{issues.length > 1 ? ` (+${issues.length - 1})` : ""}
                    </Badge>
                  )}
                </div>
                {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
              </div>
              <Switch checked={t.active} onCheckedChange={() => toggle(t)} />
              <Button variant="ghost" size="sm" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No types yet.</p>}
      </div>
    </Card>
  );
}

function TypeFormDialog({ editing, onSaved }: { editing: WorkItemType | null; onSaved: () => void }) {
  const [form, setForm] = useState({
    key: editing?.key ?? "",
    keyEdited: !!editing,
    name: editing?.name ?? "",
    description: editing?.description ?? "",
    color: editing?.color ?? "#3b82f6",
    sort_order: editing?.sort_order ?? 100,
    id_prefix: editing?.id_prefix ?? "",
  });

  const onNameChange = (name: string) => {
    setForm((f) => ({
      ...f, name,
      key: f.keyEdited ? f.key : toKey(name),
      id_prefix: f.id_prefix || name.split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 4),
    }));
  };

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    if (!isValidKey(form.key)) return toast.error("Invalid internal key — must start with a letter");
    const prefix = form.id_prefix.trim().toUpperCase();
    if (prefix && !/^[A-Z][A-Z0-9]{0,7}$/.test(prefix)) {
      return toast.error("ID prefix must be 1-8 uppercase letters/digits, starting with a letter");
    }
    try {
      const payload = {
        key: form.key, name: form.name, description: form.description,
        color: form.color, sort_order: form.sort_order,
        id_prefix: prefix || null,
      };
      if (editing) await workItemTypesService.update(editing.id, payload);
      else await workItemTypesService.create(payload);
      toast.success("Saved");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
  };

  const year = new Date().getFullYear();
  const sample = form.id_prefix
    ? `${form.id_prefix.toUpperCase()}-${year}-0001`
    : "T-0001";

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Work Item Type</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. Audit" autoFocus />
          {form.key && <p className="text-[10px] text-muted-foreground mt-1">Internal key: <code>{form.key}</code></p>}
        </div>
        <div><Label>Description</Label><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="What this type is used for" /></div>
        <div>
          <Label>Auto-ID prefix</Label>
          <Input value={form.id_prefix} onChange={(e) => setForm({ ...form, id_prefix: e.target.value.toUpperCase() })} placeholder="e.g. DV, QI, CR" maxLength={8} />
          <p className="text-[10px] text-muted-foreground mt-1">Each new item gets a code like <code>{sample}</code></p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Color</Label><Input type="color" value={form.color ?? "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9" /></div>
          <div><Label>Sort order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
        </div>
      </div>
      <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
    </DialogContent>
  );
}
