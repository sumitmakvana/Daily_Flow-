import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { workItemTypesService } from "@/services/work-item-types";
import { approvalsService, type ApprovalChain, type ApprovalStep } from "@/services/approvals";
import { dynamicFieldsService, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItemType } from "@/lib/types";
import { TypeSelector } from "./TypeSelector";
import { UserPicker } from "./UserPicker";
import { RoleSelect } from "./RoleSelect";
import { toast } from "sonner";
import { Plus, Trash2, AlertCircle } from "lucide-react";

// Built-in person columns on tasks that can carry the approver identity.
const BUILTIN_REVIEWER_FIELDS = [
  { key: "reviewer", label: "Reviewer (built-in)" },
  { key: "assigned_to", label: "Assignee (built-in)" },
];

export function ApprovalsPanel() {
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [chains, setChains] = useState<ApprovalChain[]>([]);
  const [activeChain, setActiveChain] = useState<ApprovalChain | null>(null);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [fieldDefs, setFieldDefs] = useState<WorkItemFieldDef[]>([]);
  const [chainOpen, setChainOpen] = useState(false);
  const [stepOpen, setStepOpen] = useState(false);

  useEffect(() => {
    workItemTypesService.list(true).then((ts) => { setTypes(ts); if (!typeId && ts[0]) setTypeId(ts[0].id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChains = async () => {
    if (!typeId) return;
    try {
      const [cs, defs] = await Promise.all([
        approvalsService.listChainsForType(typeId),
        dynamicFieldsService.listDefs(typeId),
      ]);
      setChains(cs);
      setFieldDefs(defs);
      setActiveChain((prev) => cs.find((c) => c.id === prev?.id) ?? cs[0] ?? null);
    } catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { loadChains(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [typeId]);

  const loadSteps = async () => {
    if (!activeChain) { setSteps([]); return; }
    try { setSteps(await approvalsService.listSteps(activeChain.id)); }
    catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { loadSteps(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeChain?.id]);

  const removeChain = async (c: ApprovalChain) => {
    if (!confirm(`Delete chain "${c.name}"?`)) return;
    const { error } = await supabase.from("approval_chains").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    setActiveChain(null); loadChains();
  };
  const removeStep = async (s: ApprovalStep) => {
    if (!confirm(`Delete step "${s.name}"?`)) return;
    const { error } = await supabase.from("approval_steps").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    loadSteps();
  };

  const personFields = fieldDefs.filter((d) => d.data_type === "user").map((d) => ({ key: d.key, label: d.label }));
  const reviewerFieldOptions = [...BUILTIN_REVIEWER_FIELDS, ...personFields];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Approval Chains</h2>
          <p className="text-xs text-muted-foreground">Multi-step sign-off flows. Each step picks who approves.</p>
        </div>
        <TypeSelector types={types} value={typeId} onChange={setTypeId} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Chains</span>
            <Dialog open={chainOpen} onOpenChange={setChainOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={!typeId}><Plus className="h-3 w-3" /></Button>
              </DialogTrigger>
              <ChainForm typeId={typeId} onSaved={() => { setChainOpen(false); loadChains(); }} />
            </Dialog>
          </div>
          <div className="space-y-1">
            {chains.map((c) => (
              <div key={c.id} className={`flex items-center gap-1 p-2 rounded cursor-pointer text-sm ${activeChain?.id === c.id ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => setActiveChain(c)}>
                <span className="flex-1 truncate">{c.name}</span>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); removeChain(c); }}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
            {chains.length === 0 && <p className="text-xs text-muted-foreground p-2">No chains yet. Click + to start.</p>}
          </div>
        </div>

        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{activeChain ? `Steps for "${activeChain.name}"` : "Select a chain"}</span>
            {activeChain && (
              <Dialog open={stepOpen} onOpenChange={setStepOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline"><Plus className="h-3 w-3 mr-1" />Step</Button>
                </DialogTrigger>
                <StepForm chainId={activeChain.id} nextOrder={(steps.at(-1)?.step_order ?? 0) + 1} reviewerFieldOptions={reviewerFieldOptions} onSaved={() => { setStepOpen(false); loadSteps(); }} />
              </Dialog>
            )}
          </div>
          {activeChain && steps.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 rounded px-2 py-1">
              <AlertCircle className="h-3 w-3" />Chain has no steps — it won't trigger until at least one step is added.
            </div>
          )}
          <div className="space-y-1">
            {steps.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-border/40 py-2 last:border-0">
                <span className="text-xs text-muted-foreground w-6 text-center">{s.step_order}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                    {s.approver_mode === "role" && <Badge variant="outline" className="text-[10px] h-4">role: {s.approver_role_key ?? s.approver_role}</Badge>}
                    {s.approver_mode === "user" && <Badge variant="outline" className="text-[10px] h-4">specific user</Badge>}
                    {s.approver_mode === "reviewer_field" && <Badge variant="outline" className="text-[10px] h-4">from item field</Badge>}
                    {s.required_count > 1 && <span>· {s.required_count} required</span>}
                    {s.allow_self && <span>· allow self</span>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeStep(s)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ChainForm({ typeId, onSaved }: { typeId: string | null; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const save = async () => {
    if (!typeId || !name) return toast.error("Name required");
    const { error } = await supabase.from("approval_chains").insert({ type_id: typeId, name, description } as never);
    if (error) return toast.error(error.message);
    toast.success("Created"); onSaved();
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New Approval Chain</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard 2-step" autoFocus /></div>
        <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></div>
      </div>
      <DialogFooter><Button onClick={save}>Create</Button></DialogFooter>
    </DialogContent>
  );
}

function StepForm({
  chainId, nextOrder, reviewerFieldOptions, onSaved,
}: {
  chainId: string;
  nextOrder: number;
  reviewerFieldOptions: Array<{ key: string; label: string }>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    step_order: nextOrder,
    approver_mode: "role" as "role" | "user" | "reviewer_field",
    approver_role_key: "manager",
    approver_user_id: null as string | null,
    approver_field: reviewerFieldOptions[0]?.key ?? "reviewer",
    required_count: 1,
    allow_self: false,
  });
  const save = async () => {
    if (!form.name) return toast.error("Name required");
    if (form.approver_mode === "user" && !form.approver_user_id) return toast.error("Pick a user");
    if (form.approver_mode === "role" && !form.approver_role_key) return toast.error("Pick a role");
    const payload: Record<string, unknown> = {
      chain_id: chainId, name: form.name, step_order: form.step_order,
      approver_mode: form.approver_mode, required_count: form.required_count, allow_self: form.allow_self,
    };
    if (form.approver_mode === "role") payload.approver_role_key = form.approver_role_key;
    if (form.approver_mode === "user") payload.approver_user_id = form.approver_user_id;
    const { error } = await supabase.from("approval_steps").insert(payload as never);
    if (error) return toast.error(error.message);
    toast.success("Added"); onSaved();
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New Step</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Area Manager review" autoFocus /></div>
          <div><Label>Order</Label><Input type="number" value={form.step_order} onChange={(e) => setForm({ ...form, step_order: Number(e.target.value) })} /></div>
        </div>
        <div>
          <Label>Who approves?</Label>
          <Select value={form.approver_mode} onValueChange={(v) => setForm({ ...form, approver_mode: v as typeof form.approver_mode })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="role">Anyone with role</SelectItem>
              <SelectItem value="user">A specific person</SelectItem>
              <SelectItem value="reviewer_field">Person named on the work item</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.approver_mode === "role" && (
          <div>
            <Label>Role</Label>
            <RoleSelect value={form.approver_role_key} onChange={(k) => setForm({ ...form, approver_role_key: k })} />
            <p className="text-[10px] text-muted-foreground mt-1">Manage role labels under the Roles tab.</p>
          </div>
        )}
        {form.approver_mode === "user" && (
          <div>
            <Label>Person</Label>
            <UserPicker value={form.approver_user_id} onChange={(id) => setForm({ ...form, approver_user_id: id })} />
          </div>
        )}
        {form.approver_mode === "reviewer_field" && (
          <div>
            <Label>Which field on the work item?</Label>
            <Select value={form.approver_field} onValueChange={(v) => setForm({ ...form, approver_field: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {reviewerFieldOptions.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Add a "Person" custom field to expose more options here.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 items-end">
          <div><Label>Required approvals</Label><Input type="number" min={1} value={form.required_count} onChange={(e) => setForm({ ...form, required_count: Number(e.target.value) })} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={form.allow_self} onCheckedChange={(v) => setForm({ ...form, allow_self: v })} />Allow self-approval</label>
        </div>
      </div>
      <DialogFooter><Button onClick={save}>Add</Button></DialogFooter>
    </DialogContent>
  );
}
