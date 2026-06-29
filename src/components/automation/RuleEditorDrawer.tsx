import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { automationsService, type AutomationRule } from "@/services/automations";
import { workItemTypesService } from "@/services/work-item-types";
import type { WorkItemType } from "@/lib/types";
import {
  TRIGGER_KINDS, triggerLabel,
  type Action, type TriggerKind,
} from "@/lib/automation/actions";
import { validateRule } from "@/lib/automation/validators";
import { ActionCard } from "./ActionCard";
import { GuardBuilder } from "./GuardBuilder";
import { ImpactAnalysis } from "./ImpactAnalysis";
import type { GuardExpr } from "@/lib/guard";

/** Subset of rule fields that a template (or other caller) can pre-fill. */
export type RulePrefill = {
  name: string;
  description?: string | null;
  description_internal?: string | null;
  type_id: string | null;
  trigger_kind: TriggerKind;
  condition_expr: GuardExpr;
  actions: Action[];
  dedupe_window_minutes: number;
  max_runs_per_minute: number;
  max_runs_per_entity: number | null;
  allow_self_retrigger: boolean;
};

type FormState = {
  name: string;
  description: string;
  description_internal: string;
  type_id: string | null;
  trigger_kind: TriggerKind;
  condition_expr: GuardExpr;
  actions: Action[];
  dedupe_window_minutes: number;
  max_runs_per_entity: number | null;
  max_runs_per_minute: number;
  allow_self_retrigger: boolean;
  is_active: boolean;
};

const EMPTY: FormState = {
  name: "", description: "", description_internal: "",
  type_id: null, trigger_kind: "status.changed", condition_expr: {},
  actions: [], dedupe_window_minutes: 60, max_runs_per_entity: null,
  max_runs_per_minute: 60, allow_self_retrigger: false, is_active: false,
};

export function RuleEditorDrawer({
  rule, prefill, open, onClose, onSaved,
}: {
  rule: AutomationRule | null;
  prefill?: RulePrefill | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => { workItemTypesService.list().then(setTypes).catch(() => {}); }, []);

  useEffect(() => {
    if (rule) {
      setForm({
        name: rule.name,
        description: rule.description ?? "",
        description_internal: rule.description_internal ?? "",
        type_id: rule.type_id,
        trigger_kind: rule.trigger_kind,
        condition_expr: rule.condition_expr ?? {},
        actions: rule.actions ?? [],
        dedupe_window_minutes: rule.dedupe_window_minutes,
        max_runs_per_entity: rule.max_runs_per_entity,
        max_runs_per_minute: rule.max_runs_per_minute,
        allow_self_retrigger: rule.allow_self_retrigger,
        is_active: rule.is_active,
      });
    } else if (open && prefill) {
      setForm({
        ...EMPTY,
        ...prefill,
        description: prefill.description ?? "",
        description_internal: prefill.description_internal ?? "",
        is_active: false,
      });
    } else if (open) {
      setForm(EMPTY);
    }
  }, [rule, prefill, open]);

  const issues = validateRule({
    trigger_kind: form.trigger_kind,
    actions: form.actions,
    dedupe_window_minutes: form.dedupe_window_minutes,
    allow_self_retrigger: form.allow_self_retrigger,
    description_internal: form.description_internal,
  });
  const errors = issues.filter((i) => i.level === "error");

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name required");
    if (errors.length) return toast.error(errors[0].message);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        description_internal: form.description_internal || null,
        type_id: form.type_id,
        trigger_kind: form.trigger_kind,
        condition_expr: form.condition_expr,
        actions: form.actions,
        dedupe_window_minutes: form.dedupe_window_minutes,
        max_runs_per_entity: form.max_runs_per_entity,
        max_runs_per_minute: form.max_runs_per_minute,
        allow_self_retrigger: form.allow_self_retrigger,
        is_active: form.is_active,
      } as Partial<AutomationRule>;
      if (rule) await automationsService.update(rule.id, payload);
      else await automationsService.create(payload);
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addAction = () =>
    setForm((f) => ({ ...f, actions: [...f.actions, { kind: "notify_user", params: {} } as Action] }));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader><SheetTitle>{rule ? "Edit rule" : "New rule"}</SheetTitle></SheetHeader>

        <div className="space-y-4 mt-4 text-sm">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Description (admin-facing)</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase">1. WHEN — Trigger</Label>
            <Select value={form.trigger_kind} onValueChange={(v) => setForm({ ...form, trigger_kind: v as TriggerKind })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_KINDS.map((t) => <SelectItem key={t} value={t}>{triggerLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase">2. ON — Work item type</Label>
            <Select
              value={form.type_id ?? "__any__"}
              onValueChange={(v) => setForm({ ...form, type_id: v === "__any__" ? null : v })}
            >
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any type</SelectItem>
                {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase">3. IF — Conditions</Label>
            <GuardBuilder value={form.condition_expr} onChange={(v) => setForm({ ...form, condition_expr: v })} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase">4. THEN — Actions</Label>
            <div className="space-y-2">
              {form.actions.map((a, i) => (
                <ActionCard
                  key={i}
                  action={a}
                  index={i}
                  onChange={(next) => {
                    const arr = [...form.actions]; arr[i] = next;
                    setForm({ ...form, actions: arr });
                  }}
                  onRemove={() => setForm({ ...form, actions: form.actions.filter((_, j) => j !== i) })}
                />
              ))}
              <Button variant="outline" size="sm" onClick={addAction}>
                <Plus className="h-3 w-3 mr-1" />Add action
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase">Impact analysis</Label>
            <ImpactAnalysis
              input={{
                trigger_kind: form.trigger_kind,
                type_id: form.type_id,
                condition_expr: form.condition_expr,
                actions: form.actions,
              }}
            />
          </div>

          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs uppercase">5. SAFETY</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Dedupe window (min)</Label>
                <Input
                  type="number" min={0}
                  value={form.dedupe_window_minutes}
                  onChange={(e) => setForm({ ...form, dedupe_window_minutes: Math.max(0, Number(e.target.value)) })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Max runs / minute</Label>
                <Input
                  type="number" min={1}
                  value={form.max_runs_per_minute}
                  onChange={(e) => setForm({ ...form, max_runs_per_minute: Math.max(1, Number(e.target.value)) })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Max runs / entity (optional)</Label>
                <Input
                  type="number" min={1}
                  value={form.max_runs_per_entity ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, max_runs_per_entity: e.target.value ? Number(e.target.value) : null })
                  }
                  className="h-8"
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs">
              <Switch
                checked={form.allow_self_retrigger}
                onCheckedChange={(v) => setForm({ ...form, allow_self_retrigger: v })}
              />
              <div>
                <span className="font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  Allow self-retrigger
                </span>
                <p className="text-muted-foreground">Required when actions can re-fire this rule's trigger.</p>
              </div>
            </label>
            {form.allow_self_retrigger && (
              <div>
                <Label className="text-xs">Internal rationale</Label>
                <Input
                  value={form.description_internal}
                  onChange={(e) => setForm({ ...form, description_internal: e.target.value })}
                  className="h-8"
                  placeholder="Why this rule needs to mutate its own trigger surface"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              Active
            </label>
          </div>

          {issues.length > 0 && (
            <div className="space-y-1">
              {issues.map((i, idx) => (
                <Alert key={idx} variant={i.level === "error" ? "destructive" : "default"} className="py-2">
                  <AlertDescription className="text-xs">{i.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={errors.length > 0}>Save</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
