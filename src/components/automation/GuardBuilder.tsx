import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";
import type { GuardClause, GuardExpr, GuardOp } from "@/lib/guard";

const OPS: GuardOp[] = ["eq", "neq", "in", "nin", "gt", "gte", "lt", "lte", "is_set", "is_empty"];

export function GuardBuilder({ value, onChange }: { value: GuardExpr; onChange: (v: GuardExpr) => void }) {
  const v = (value ?? {}) as { all?: GuardClause[]; any?: GuardClause[] };
  const all = v.all ?? [];
  const any = v.any ?? [];

  const update = (next: { all?: GuardClause[]; any?: GuardClause[] }) => {
    const out: { all?: GuardClause[]; any?: GuardClause[] } = {};
    if (next.all?.length) out.all = next.all;
    if (next.any?.length) out.any = next.any;
    onChange(out as GuardExpr);
  };

  const renderGroup = (key: "all" | "any", list: GuardClause[]) => (
    <div className="space-y-1">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {key === "all" ? "All of (AND)" : "Any of (OR)"}
      </div>
      {list.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            value={c.field}
            onChange={(e) => {
              const next = [...list]; next[i] = { ...c, field: e.target.value };
              update({ ...v, [key]: next });
            }}
            placeholder="field (e.g. status, custom_fields key)"
            className="h-7 text-xs flex-1"
          />
          <Select
            value={c.op}
            onValueChange={(op) => {
              const next = [...list]; next[i] = { ...c, op: op as GuardOp };
              update({ ...v, [key]: next });
            }}
          >
            <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          {c.op !== "is_set" && c.op !== "is_empty" && (
            <Input
              value={typeof c.value === "string" ? c.value : JSON.stringify(c.value ?? "")}
              onChange={(e) => {
                let parsed: unknown = e.target.value;
                if (e.target.value.startsWith("[") || /^-?\d+$/.test(e.target.value)) {
                  try { parsed = JSON.parse(e.target.value); } catch { /* keep string */ }
                }
                const next = [...list]; next[i] = { ...c, value: parsed };
                update({ ...v, [key]: next });
              }}
              placeholder="value"
              className="h-7 text-xs w-32"
            />
          )}
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => update({ ...v, [key]: list.filter((_, j) => j !== i) })}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        type="button" variant="outline" size="sm"
        onClick={() => update({ ...v, [key]: [...list, { field: "", op: "eq", value: "" }] })}
      >
        <Plus className="h-3 w-3 mr-1" />Add clause
      </Button>
    </div>
  );

  return (
    <div className="space-y-3 border border-border/40 rounded p-2 bg-muted/20">
      {renderGroup("all", all)}
      {renderGroup("any", any)}
      {!all.length && !any.length && (
        <p className="text-[10px] text-muted-foreground">No conditions — rule fires on every matching event.</p>
      )}
    </div>
  );
}
