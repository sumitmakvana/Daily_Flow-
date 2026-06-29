import { useState } from "react";
import { useNavigate, createFileRoute, redirect } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagInput } from "@/components/configure/TagInput";
import { TypePreviewSheet } from "@/components/configure/TypePreviewSheet";
import { ConfigHealthBadge } from "@/components/configure/ConfigHealthBadge";
import { toKey } from "@/lib/slug";
import { supabase } from "@/integrations/supabase/client";
import { workItemTypesService } from "@/services/work-item-types";
import { analyze } from "@/services/config-health";
import type { WorkItemFieldDef, FieldDataType } from "@/services/dynamic-fields";
import type { WorkItemStatus, WorkItemTransition } from "@/services/workflow";
import type { ApprovalChain, ApprovalStep } from "@/services/approvals";
import type { WorkItemType } from "@/lib/types";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2, Eye, Rocket, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configure/new")({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin");
    if (!data?.length) throw redirect({ to: "/today" });
  },
  component: NewTypeWizard,
});

const STEPS = ["Name", "Fields", "Workflow", "Approvals", "Preview", "Publish"] as const;

const WORKFLOW_PRESETS = {
  simple: { name: "Simple (To Do → Done)", statuses: [
    { label: "To Do", category: "todo", is_initial: true, is_terminal: false, color: "#94a3b8" },
    { label: "Done", category: "done", is_initial: false, is_terminal: true, color: "#10b981" },
  ]},
  linear: { name: "Linear (To Do → In Progress → Done)", statuses: [
    { label: "To Do", category: "todo", is_initial: true, is_terminal: false, color: "#94a3b8" },
    { label: "In Progress", category: "in_progress", is_initial: false, is_terminal: false, color: "#3b82f6" },
    { label: "Done", category: "done", is_initial: false, is_terminal: true, color: "#10b981" },
  ]},
  review: { name: "With Review (Planned → In Progress → Manager Review → Approved)", statuses: [
    { label: "Planned", category: "todo", is_initial: true, is_terminal: false, color: "#94a3b8" },
    { label: "In Progress", category: "in_progress", is_initial: false, is_terminal: false, color: "#3b82f6" },
    { label: "Manager Review", category: "in_progress", is_initial: false, is_terminal: false, color: "#f59e0b" },
    { label: "Approved", category: "done", is_initial: false, is_terminal: true, color: "#10b981" },
  ]},
} as const;

type DraftField = { label: string; data_type: FieldDataType; required: boolean; options: string[] };
type DraftStatus = { label: string; category: "todo"|"in_progress"|"done"|"cancelled"; is_initial: boolean; is_terminal: boolean; color: string };
type DraftStep = { name: string; approver_mode: "role"|"user"|"reviewer_field"; approver_role: "admin"|"manager"|"member" };

function NewTypeWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3b82f6");

  // Step 2
  const [fields, setFields] = useState<DraftField[]>([]);

  // Step 3
  const [presetKey, setPresetKey] = useState<keyof typeof WORKFLOW_PRESETS>("linear");
  const [statuses, setStatuses] = useState<DraftStatus[]>([...WORKFLOW_PRESETS.linear.statuses]);

  // Step 4
  const [wantApproval, setWantApproval] = useState(false);
  const [chainName, setChainName] = useState("Standard approval");
  const [steps, setSteps] = useState<DraftStep[]>([
    { name: "Manager review", approver_mode: "role", approver_role: "manager" },
  ]);

  const choosePreset = (k: keyof typeof WORKFLOW_PRESETS) => {
    setPresetKey(k);
    setStatuses([...WORKFLOW_PRESETS[k].statuses]);
  };

  // Build a fake type + defs/statuses/transitions/chain for preview + health
  const previewType: WorkItemType = {
    id: "draft", key: toKey(name) || "draft", name: name || "Untitled",
    description, color, icon: null, active: true, sort_order: 100,
  } as WorkItemType;

  const draftFieldDefs: WorkItemFieldDef[] = fields.map((f, i) => ({
    id: `f${i}`, type_id: "draft", key: toKey(f.label) || `field_${i}`, label: f.label,
    data_type: f.data_type, required: f.required,
    options: f.options.map((o) => ({ value: toKey(o) || o, label: o })),
    validation: {}, sort_order: i, is_active: true,
  }));
  const draftStatuses: WorkItemStatus[] = statuses.map((s, i) => ({
    id: `s${i}`, type_id: "draft", key: toKey(s.label), label: s.label,
    category: s.category, color: s.color, sort_order: i,
    is_initial: s.is_initial, is_terminal: s.is_terminal,
  }));
  const draftTransitions: WorkItemTransition[] = draftStatuses.slice(0, -1).map((s, i) => ({
    id: `t${i}`, type_id: "draft", from_status_id: s.id, to_status_id: draftStatuses[i + 1].id,
    label: null, required_role: null, required_role_key: null, guard_expr: {}, sort_order: i,
  }));
  const draftChain: ApprovalChain | null = wantApproval ? {
    id: "c1", type_id: "draft", name: chainName, description: null, is_active: true, version: 1,
  } : null;
  const draftChainSteps: ApprovalStep[] = wantApproval ? steps.map((s, i) => ({
    id: `cs${i}`, chain_id: "c1", step_order: i + 1, name: s.name,
    approver_mode: s.approver_mode, approver_role: s.approver_role, approver_role_key: null,
    approver_user_id: null, required_count: 1, allow_self: false,
  })) : [];

  const health = analyze(
    previewType, draftStatuses, draftTransitions, draftFieldDefs,
    draftChain ? [draftChain] : [],
    draftChain ? { [draftChain.id]: draftChainSteps } : {}
  );

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 2) return statuses.length >= 2 && statuses.some((s) => s.is_initial);
    if (step === 3 && wantApproval) return steps.length > 0 && steps.every((s) => s.name);
    return true;
  };

  const publish = async () => {
    if (health.status === "error") {
      toast.error("Fix blocking issues before publishing");
      return;
    }
    setPublishing(true);
    try {
      const typeKey = toKey(name);
      // 1. Create type
      const t = await workItemTypesService.create({ key: typeKey, name, description, color, sort_order: 100 });

      // 2. Create statuses, capture IDs in order
      const statusIds: string[] = [];
      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i];
        const { data, error } = await supabase.from("work_item_statuses").insert({
          type_id: t.id, key: toKey(s.label), label: s.label, category: s.category,
          color: s.color, sort_order: i, is_initial: s.is_initial, is_terminal: s.is_terminal,
        } as never).select("id").single();
        if (error) throw error;
        statusIds.push((data as { id: string }).id);
      }

      // 3. Create linear transitions between sequential statuses
      for (let i = 0; i < statusIds.length - 1; i++) {
        const { error } = await supabase.from("work_item_transitions").insert({
          type_id: t.id, from_status_id: statusIds[i], to_status_id: statusIds[i + 1], sort_order: i,
        } as never);
        if (error) throw error;
      }

      // 4. Create fields
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const { error } = await supabase.from("work_item_field_defs").insert({
          type_id: t.id, key: toKey(f.label), label: f.label, data_type: f.data_type,
          required: f.required,
          options: f.options.map((o) => ({ value: toKey(o) || o, label: o })),
          sort_order: i,
        } as never);
        if (error) throw error;
      }

      // 5. Approval chain + steps
      if (wantApproval) {
        const { data: chain, error: cErr } = await supabase.from("approval_chains")
          .insert({ type_id: t.id, name: chainName } as never).select("id").single();
        if (cErr) throw cErr;
        const chainId = (chain as { id: string }).id;
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const { error } = await supabase.from("approval_steps").insert({
            chain_id: chainId, step_order: i + 1, name: s.name,
            approver_mode: s.approver_mode, approver_role: s.approver_role,
            required_count: 1, allow_self: false,
          } as never);
          if (error) throw error;
        }
      }

      toast.success(`"${name}" published`);
      setPublished(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">New Work Type</h1>
          <p className="text-xs text-muted-foreground">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/configure" })}>Cancel</Button>
      </div>

      <Tabs value={String(step)}>
        <TabsList className="flex-wrap h-auto">
          {STEPS.map((s, i) => (
            <TabsTrigger key={s} value={String(i)} onClick={() => i <= step && setStep(i)} disabled={i > step}>
              {i + 1}. {s}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="p-4 space-y-3">
        {step === 0 && (
          <div className="space-y-3">
            <div>
              <Label>What are you tracking?</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Doctor Visit, Site Inspection, Service Request" autoFocus />
              <p className="text-[10px] text-muted-foreground mt-1">A short name your team will recognize.</p>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this work is for" />
            </div>
            <div>
              <Label>Color</Label>
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-24" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">What information should the team capture? Built-in fields (assignee, due date, priority, description) are always available.</p>
            {fields.map((f, i) => (
              <div key={i} className="rounded-md border border-border/60 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={f.label} onChange={(e) => { const c = [...fields]; c[i] = { ...f, label: e.target.value }; setFields(c); }} placeholder="Field name e.g. Doctor Name" className="flex-1" />
                  <Select value={f.data_type} onValueChange={(v) => { const c = [...fields]; c[i] = { ...f, data_type: v as FieldDataType }; setFields(c); }}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="datetime">Date & time</SelectItem>
                      <SelectItem value="boolean">Yes / No</SelectItem>
                      <SelectItem value="select">Choice (single)</SelectItem>
                      <SelectItem value="multiselect">Choice (multiple)</SelectItem>
                      <SelectItem value="user">Person</SelectItem>
                      <SelectItem value="url">Link</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1 text-xs"><Switch checked={f.required} onCheckedChange={(v) => { const c = [...fields]; c[i] = { ...f, required: v }; setFields(c); }} />Required</label>
                  <Button variant="ghost" size="sm" onClick={() => setFields(fields.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                </div>
                {(f.data_type === "select" || f.data_type === "multiselect") && (
                  <div>
                    <Label className="text-xs">Choices (press Enter after each)</Label>
                    <TagInput values={f.options} onChange={(v) => { const c = [...fields]; c[i] = { ...f, options: v }; setFields(c); }} placeholder="e.g. Doctor" />
                  </div>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setFields([...fields, { label: "", data_type: "text", required: false, options: [] }])}>
              <Plus className="h-3 w-3 mr-1" />Add field
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <Label>Choose a starting workflow</Label>
              <Select value={presetKey} onValueChange={(v) => choosePreset(v as keyof typeof WORKFLOW_PRESETS)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(WORKFLOW_PRESETS).map(([k, v]) => <SelectItem key={k} value={k}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">You can edit individual statuses below. Items move through statuses in the order shown.</p>
            </div>
            <div className="space-y-2">
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-border/60 p-2">
                  <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <Input value={s.label} onChange={(e) => { const c = [...statuses]; c[i] = { ...s, label: e.target.value }; setStatuses(c); }} className="flex-1" />
                  <Input type="color" value={s.color} onChange={(e) => { const c = [...statuses]; c[i] = { ...s, color: e.target.value }; setStatuses(c); }} className="h-9 w-12 p-1" />
                  <label className="flex items-center gap-1 text-xs"><Switch checked={s.is_initial} onCheckedChange={(v) => { const c = statuses.map((x, j) => ({ ...x, is_initial: j === i ? v : v ? false : x.is_initial })); setStatuses(c); }} />Start</label>
                  <label className="flex items-center gap-1 text-xs"><Switch checked={s.is_terminal} onCheckedChange={(v) => { const c = [...statuses]; c[i] = { ...s, is_terminal: v, category: v ? "done" : s.category }; setStatuses(c); }} />End</label>
                  <Button variant="ghost" size="sm" onClick={() => setStatuses(statuses.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setStatuses([...statuses, { label: "New status", category: "in_progress", is_initial: false, is_terminal: false, color: "#94a3b8" }])}>
                <Plus className="h-3 w-3 mr-1" />Add status
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={wantApproval} onCheckedChange={setWantApproval} />
              Require approval before items are marked complete
            </label>
            {wantApproval && (
              <>
                <div>
                  <Label>Chain name</Label>
                  <Input value={chainName} onChange={(e) => setChainName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-border/60 p-2">
                      <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                      <Input value={s.name} onChange={(e) => { const c = [...steps]; c[i] = { ...s, name: e.target.value }; setSteps(c); }} placeholder="Step name e.g. Manager review" className="flex-1" />
                      <Select value={s.approver_role} onValueChange={(v) => { const c = [...steps]; c[i] = { ...s, approver_role: v as DraftStep["approver_role"] }; setSteps(c); }}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setSteps([...steps, { name: "", approver_mode: "role", approver_role: "manager" }])}>
                    <Plus className="h-3 w-3 mr-1" />Add step
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Here's what your team will see. Open the live preview for a full simulation.</p>
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ background: color }} /><span className="font-medium">{name || "Untitled"}</span><ConfigHealthBadge status={health.status} /></div>
              <div className="text-xs text-muted-foreground">
                {statuses.length} statuses · {fields.length} fields · {wantApproval ? `${steps.length}-step approval` : "no approval"}
              </div>
              {health.findings.length > 0 && (
                <ul className="text-xs space-y-1">
                  {health.findings.map((f, i) => (
                    <li key={i} className={f.level === "error" ? "text-destructive" : "text-amber-600"}>• {f.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4 mr-2" />Open live preview</Button>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 text-center py-6">
            {published ? (
              <>
                <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
                <div className="text-lg font-semibold">Published</div>
                <p className="text-sm text-muted-foreground">"{name}" is now available to your team.</p>
                <div className="flex justify-center gap-2 pt-2">
                  <Button onClick={() => navigate({ to: "/configure" })}>Back to Configure</Button>
                  <Button variant="outline" onClick={() => navigate({ to: "/tasks" })}>Create one now</Button>
                </div>
              </>
            ) : (
              <>
                <Rocket className="h-12 w-12 text-primary mx-auto" />
                <div className="text-lg font-semibold">Ready to publish?</div>
                {health.status === "error" ? (
                  <Badge variant="outline" className="text-destructive border-destructive">Fix issues first</Badge>
                ) : health.status === "warning" ? (
                  <Badge variant="outline" className="text-amber-600 border-amber-500/50">Has warnings — publishing anyway is OK</Badge>
                ) : (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/50">All checks pass</Badge>
                )}
                <div className="pt-2">
                  <Button size="lg" onClick={publish} disabled={publishing || health.status === "error"}>
                    {publishing ? "Publishing…" : "Publish"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      {!published && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>
          <div className="flex gap-2">
            {step >= 1 && (
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4 mr-1" />Preview</Button>
            )}
            {step < STEPS.length - 1 && (
              <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
            )}
          </div>
        </div>
      )}

      <TypePreviewSheet
        type={previewType}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        draftFields={draftFieldDefs}
        draftStatuses={draftStatuses}
        draftTransitions={draftTransitions}
        draftChain={draftChain ? { chain: draftChain, steps: draftChainSteps } : null}
      />
    </div>
  );
}
