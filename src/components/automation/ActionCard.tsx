import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { ACTION_KINDS, actionLabel, type Action, type ActionKind } from "@/lib/automation/actions";

export function ActionCard({
  action, index, onChange, onRemove,
}: {
  action: Action;
  index: number;
  onChange: (next: Action) => void;
  onRemove: () => void;
}) {
  const setKind = (kind: ActionKind) => onChange({ kind, params: {} } as Action);
  const setParam = (key: string, value: unknown) =>
    onChange({ ...action, params: { ...(action.params as Record<string, unknown>), [key]: value } } as Action);
  const p = action.params as Record<string, unknown>;
  const get = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");

  return (
    <Card className="p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-5">{index + 1}.</span>
        <Select value={action.kind} onValueChange={(v) => setKind(v as ActionKind)}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTION_KINDS.map((k) => <SelectItem key={k} value={k}>{actionLabel(k)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={onRemove}><X className="h-3 w-3" /></Button>
      </div>
      <div className="space-y-1 pl-7">
        {renderParams(action.kind, get, setParam)}
        <p className="text-[10px] text-muted-foreground">
          Use <code>{"{{ctx.field}}"}</code> to insert event values (e.g. <code>{"{{ctx.assigned_to}}"}</code>).
        </p>
      </div>
    </Card>
  );
}

function renderParams(
  kind: ActionKind,
  get: (k: string) => string,
  set: (k: string, v: unknown) => void,
) {
  const text = (key: string, label: string, placeholder?: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={get(key)} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className="h-7 text-xs" />
    </div>
  );
  const area = (key: string, label: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Textarea value={get(key)} onChange={(e) => set(key, e.target.value)} className="text-xs min-h-[60px]" />
    </div>
  );
  switch (kind) {
    case "notify_user":  return <>{text("user_id", "User ID", "uuid or {{ctx.assigned_to}}")}{text("title", "Title")}{area("body", "Body")}</>;
    case "notify_role":  return <>{text("role_key", "Role key")}{text("title", "Title")}{area("body", "Body")}</>;
    case "assign_user":  return text("user_id", "User ID", "uuid or {{ctx.actor_id}}");
    case "assign_role":  return text("role_key", "Role key");
    case "change_status":return text("status_key", "Status key");
    case "update_field": return <>{text("field_key", "Field key")}{text("value", "Value (string or JSON)")}</>;
    case "create_approval": return text("chain_id", "Approval chain ID");
    case "escalate": return <>{text("severity", "Severity (low|medium|high|critical)")}{text("summary", "Summary")}</>;
    case "create_work_item":
    case "create_followup_work_item":
      return <>{text("type_key", "Type key")}{text("task_name", "Task name")}{text("due_offset", "Due offset (e.g. +30d)")}{text("assigned_to", "Assignee user id")}</>;
    default: return null;
  }
}
