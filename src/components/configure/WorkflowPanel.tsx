import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { workItemTypesService } from "@/services/work-item-types";
import { workflowService, type WorkItemStatus, type WorkItemTransition } from "@/services/workflow";
import { dynamicFieldsService, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { describeGuard, type GuardClause, type GuardOp } from "@/lib/guard";
import { RoleSelect } from "./RoleSelect";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItemType } from "@/lib/types";
import { TypeSelector } from "./TypeSelector";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, ArrowRight } from "lucide-react";

export function WorkflowPanel() {
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<WorkItemStatus[]>([]);
  const [transitions, setTransitions] = useState<WorkItemTransition[]>([]);
  const [defs, setDefs] = useState<WorkItemFieldDef[]>([]);
  const [editing, setEditing] = useState<WorkItemTransition | { _new: true; from_status_id: string | null; to_status_id: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    workItemTypesService.list(true).then((ts) => { setTypes(ts); if (!typeId && ts[0]) setTypeId(ts[0].id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!typeId) return;
    try {
      const [s, t, d] = await Promise.all([
        workflowService.listStatuses(typeId),
        workflowService.listTransitions(typeId),
        dynamicFieldsService.listDefs(typeId),
      ]);
      setStatuses(s); setTransitions(t); setDefs(d);
    } catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [typeId]);

  const removeTransition = async (t: WorkItemTransition) => {
    if (!confirm("Delete this transition?")) return;
    const { error } = await supabase.from("work_item_transitions").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    load();
  };

  const statusLabel = (id: string | null) => id === null ? "Any" : statuses.find((s) => s.id === id)?.label ?? "?";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Workflow Transitions</h2>
          <p className="text-xs text-muted-foreground">
            Allowed status moves. Add multiple transitions out of the same status to branch on a condition.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TypeSelector types={types} value={typeId} onChange={setTypeId} />
          <Button size="sm" disabled={!typeId || statuses.length < 2} onClick={() => { setEditing({ _new: true, from_status_id: statuses[0]?.id ?? null, to_status_id: statuses[1]?.id ?? "" }); setAddOpen(true); }}>
            <Plus className="h-3 w-3 mr-1" />Transition
          </Button>
        </div>
      </div>

      {statuses.length < 2 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Add at least two statuses to this type first.</p>
      ) : transitions.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">No transitions yet. Click "Transition" to add one.</p>
      ) : (
        <div className="space-y-1">
          {transitions.map((t) => (
            <div key={t.id} className="flex items-center gap-2 border-b border-border/40 py-2 last:border-0 text-sm">
              <span className="font-medium">{statusLabel(t.from_status_id)}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{statusLabel(t.to_status_id)}</span>
              {t.label && <Badge variant="secondary" className="text-[10px] h-4">{t.label}</Badge>}
              {t.required_role_key && <Badge variant="outline" className="text-[10px] h-4">requires {t.required_role_key}</Badge>}
              <span className="text-xs text-muted-foreground flex-1 truncate">{describeGuard(t.guard_expr)}</span>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(t); setAddOpen(true); }}><Pencil className="h-3 w-3" /></Button>
              <Button variant="ghost" size="sm" onClick={() => removeTransition(t)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TransitionDialog
          open={addOpen}
          onOpenChange={(v) => { setAddOpen(v); if (!v) setEditing(null); }}
          typeId={typeId!}
          statuses={statuses}
          defs={defs}
          initial={editing}
          onSaved={() => { setAddOpen(false); setEditing(null); load(); }}
        />
      )}
    </Card>
  );
}

const OPS: { value: GuardOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "equals", needsValue: true },
  { value: "neq", label: "not equals", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  { value: "is_set", label: "is set", needsValue: false },
  { value: "is_empty", label: "is empty", needsValue: false },
];

function TransitionDialog({
  open, onOpenChange, typeId, statuses, defs, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  typeId: string;
  statuses: WorkItemStatus[];
  defs: WorkItemFieldDef[];
  initial: WorkItemTransition | { _new: true; from_status_id: string | null; to_status_id: string };
  onSaved: () => void;
}) {
  const isNew = "_new" in initial;
  const [from, setFrom] = useState<string>(isNew ? (initial.from_status_id ?? "__any__") : (initial.from_status_id ?? "__any__"));
  const [to, setTo] = useState<string>(isNew ? initial.to_status_id : initial.to_status_id);
  const [label, setLabel] = useState<string>(isNew ? "" : (initial.label ?? ""));
  const [roleKey, setRoleKey] = useState<string | null>(isNew ? null : initial.required_role_key);
  const initialClauses: GuardClause[] =
    !isNew && initial.guard_expr && "all" in (initial.guard_expr as object)
      ? ((initial.guard_expr as { all?: GuardClause[] }).all ?? [])
      : [];
  const [clauses, setClauses] = useState<GuardClause[]>(initialClauses);

  const save = async () => {
    const fromId = from === "__any__" ? null : from;
    const guard_expr = clauses.length ? { all: clauses } : {};
    const payload = {
      type_id: typeId,
      from_status_id: fromId,
      to_status_id: to,
      label: label || null,
      required_role_key: roleKey,
      guard_expr,
    };
    try {
      if (isNew) {
        const { error } = await supabase.from("work_item_transitions").insert(payload as never);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("work_item_transitions")
          .update({ label: payload.label, required_role_key: payload.required_role_key, guard_expr } as never)
          .eq("id", (initial as WorkItemTransition).id);
        if (error) throw error;
      }
      toast.success("Saved"); onSaved();
    } catch (e) { toast.error((e as Error).message); }
  };

  const guardableFields = defs.filter((d) =>
    ["text", "number", "boolean", "select", "multiselect"].includes(d.data_type)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isNew ? "New transition" : "Edit transition"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>From</Label>
              <Select value={from} onValueChange={setFrom} disabled={!isNew}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any (universal)</SelectItem>
                  {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select value={to} onValueChange={setTo} disabled={!isNew}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Button label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Follow Up, Close" />
            </div>
            <div>
              <Label>Only allowed for role (optional)</Label>
              <div className="flex gap-1">
                <div className="flex-1"><RoleSelect value={roleKey} onChange={setRoleKey} placeholder="Anyone" /></div>
                {roleKey && <Button size="sm" variant="ghost" onClick={() => setRoleKey(null)}>Clear</Button>}
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Condition (all must match)</Label>
              <Button size="sm" variant="outline" onClick={() => setClauses([...clauses, { field: guardableFields[0]?.key ?? "", op: "eq", value: "" }])} disabled={guardableFields.length === 0}>
                <Plus className="h-3 w-3 mr-1" />Add
              </Button>
            </div>
            {clauses.length === 0 && <p className="text-xs text-muted-foreground">No condition — always allowed (subject to role).</p>}
            {clauses.map((c, i) => {
              const opDef = OPS.find((o) => o.value === c.op);
              const fieldDef = defs.find((d) => d.key === c.field);
              return (
                <div key={i} className="flex gap-1 items-center mt-1">
                  <Select value={c.field} onValueChange={(v) => { const n = [...clauses]; n[i] = { ...c, field: v }; setClauses(n); }}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {guardableFields.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={c.op} onValueChange={(v) => { const n = [...clauses]; n[i] = { ...c, op: v as GuardOp }; setClauses(n); }}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {opDef?.needsValue && (
                    fieldDef?.data_type === "boolean" ? (
                      <Select value={String(c.value ?? "true")} onValueChange={(v) => { const n = [...clauses]; n[i] = { ...c, value: v === "true" }; setClauses(n); }}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Yes</SelectItem>
                          <SelectItem value="false">No</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : fieldDef?.data_type === "select" ? (
                      <Select value={String(c.value ?? "")} onValueChange={(v) => { const n = [...clauses]; n[i] = { ...c, value: v }; setClauses(n); }}>
                        <SelectTrigger className="w-32"><SelectValue placeholder="Pick" /></SelectTrigger>
                        <SelectContent>
                          {(fieldDef.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input className="w-32" value={String(c.value ?? "")} onChange={(e) => { const n = [...clauses]; const raw = e.target.value; n[i] = { ...c, value: fieldDef?.data_type === "number" ? Number(raw) : raw }; setClauses(n); }} />
                    )
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setClauses(clauses.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
