import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, AlertTriangle, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { automationsService, type AutomationRule } from "@/services/automations";
import { triggerLabel } from "@/lib/automation/actions";
import { RuleEditorDrawer, type RulePrefill } from "./RuleEditorDrawer";
import { TemplatesGallery } from "./TemplatesGallery";
import type { RuleTemplate } from "@/lib/automation/templates";
import { workItemTypesService } from "@/services/work-item-types";

export function RulesPanel() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [prefill, setPrefill] = useState<RulePrefill | null>(null);
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState(false);

  const load = () =>
    automationsService.list().then(setRules).catch((e) => toast.error((e as Error).message));
  useEffect(() => { load(); }, []);

  const toggle = async (r: AutomationRule, next: boolean) => {
    try { await automationsService.setActive(r.id, next); toast.success(next ? "Enabled" : "Disabled"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (r: AutomationRule) => {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    try { await automationsService.remove(r.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const useTemplate = async (tpl: RuleTemplate) => {
    // Resolve type_key_hint against live types; null if not found.
    let type_id: string | null = null;
    if (tpl.type_key_hint) {
      try {
        const types = await workItemTypesService.list();
        const match = types.find((t) => t.key === tpl.type_key_hint);
        type_id = match?.id ?? null;
        if (!match) {
          toast.warning(`No work item type with key "${tpl.type_key_hint}" — pick one in the editor.`);
        }
      } catch { /* swallow — editor will show empty type */ }
    }
    setPrefill({
      name: tpl.name,
      description: tpl.summary,
      description_internal: tpl.description_internal,
      type_id,
      trigger_kind: tpl.trigger_kind,
      condition_expr: tpl.condition_expr,
      actions: tpl.actions,
      dedupe_window_minutes: tpl.dedupe_window_minutes,
      max_runs_per_minute: tpl.max_runs_per_minute,
      max_runs_per_entity: tpl.max_runs_per_entity,
      allow_self_retrigger: tpl.allow_self_retrigger,
    });
    setEditing(null);
    setGallery(false);
    setOpen(true);
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Automation Rules</h2>
          <p className="text-xs text-muted-foreground">
            Trigger-driven automations. Run out-of-band via the 30-second worker tick.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setGallery(true)}>
            <Sparkles className="h-3 w-3 mr-1" />Templates
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setPrefill(null); setOpen(true); }}>
            <Plus className="h-3 w-3 mr-1" />New Rule
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {rules.map((r) => (
          <div
            key={r.id}
            className={`flex items-center gap-3 border-b border-border/40 py-2 last:border-0 ${
              !r.is_active ? "opacity-60" : ""
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                {r.name}
                {r.auto_disabled_at && (
                  <Badge variant="destructive" className="text-[10px] h-4">
                    <AlertTriangle className="h-3 w-3 mr-1" />auto-disabled
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                <code>{triggerLabel(r.trigger_kind)}</code>
                {" · "}{r.actions.length} action{r.actions.length === 1 ? "" : "s"}
                {" · dedupe "}{r.dedupe_window_minutes}m
                {r.auto_disabled_reason && (
                  <span className="text-destructive"> · {r.auto_disabled_reason}</span>
                )}
              </div>
            </div>
            <Switch checked={r.is_active && !r.auto_disabled_at} onCheckedChange={(v) => toggle(r, v)} />
            <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setPrefill(null); setOpen(true); }}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={() => remove(r)}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No rules yet — start from a template or create one from scratch.
          </p>
        )}
      </div>

      <RuleEditorDrawer
        rule={editing}
        prefill={prefill}
        open={open}
        onClose={() => { setOpen(false); setEditing(null); setPrefill(null); }}
        onSaved={() => { setOpen(false); setEditing(null); setPrefill(null); load(); }}
      />
      <TemplatesGallery open={gallery} onClose={() => setGallery(false)} onPick={useTemplate} />
    </Card>
  );
}
