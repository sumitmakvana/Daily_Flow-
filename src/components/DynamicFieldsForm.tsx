import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { UserPicker } from "@/components/configure/UserPicker";
import { PhotoField, type PhotoValue } from "@/components/fields/PhotoField";
import { GeoField, type GeoValue } from "@/components/fields/GeoField";
import { PhotoGeoField, type PhotoGeoValue } from "@/components/fields/PhotoGeoField";
import { SignatureField } from "@/components/fields/SignatureField";
import type { WorkItemFieldDef } from "@/services/dynamic-fields";

/**
 * Renders inputs for a list of WorkItemFieldDef. The parent owns the values
 * (typically `task.custom_fields`) and merges back via onChange. For capture
 * fields (photo/signature/photo+geo) the parent should pass `workItemId` once
 * the item has been saved.
 */
export function DynamicFieldsForm({
  defs,
  values,
  onChange,
  workItemId = null,
}: {
  defs: WorkItemFieldDef[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  workItemId?: string | null;
}) {
  if (defs.length === 0) return null;
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">Custom fields</div>
      {defs.map((d) => {
        const v = values[d.key];
        return (
          <div key={d.id}>
            <Label className="flex items-center gap-1">
              {d.label}
              {d.required && <span className="text-destructive">*</span>}
              {d.required_for_completion && <Badge variant="outline" className="text-[9px] h-4 ml-1">required to complete</Badge>}
            </Label>
            {renderInput(d, v, (next) => set(d.key, next), workItemId)}
          </div>
        );
      })}
    </div>
  );
}

function renderInput(d: WorkItemFieldDef, v: unknown, set: (v: unknown) => void, workItemId: string | null) {
  switch (d.data_type) {
    case "number":
      return <Input type="number" value={(v as number) ?? ""} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />;
    case "date":
      return (
        <Input
          type="date"
          value={(v as string) ?? ""}
          onChange={(e) => set(e.target.value || null)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch (err) {}
          }}
          className="cursor-pointer"
        />
      );
    case "datetime":
      return (
        <Input
          type="datetime-local"
          value={(v as string) ?? ""}
          onChange={(e) => set(e.target.value || null)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch (err) {}
          }}
          className="cursor-pointer"
        />
      );
    case "boolean":
      return <div className="pt-2"><Switch checked={!!v} onCheckedChange={set} /></div>;
    case "url":
      return <Input type="url" value={(v as string) ?? ""} onChange={(e) => set(e.target.value || null)} placeholder="https://" />;
    case "email":
      return <Input type="email" value={(v as string) ?? ""} onChange={(e) => set(e.target.value || null)} />;
    case "user":
      return <UserPicker value={(v as string) ?? null} onChange={set} />;
    case "photo":
      return <PhotoField value={(v as PhotoValue) ?? null} onChange={set} workItemId={workItemId} />;
    case "geo":
      return <GeoField value={(v as GeoValue) ?? null} onChange={set} />;
    case "photo_geo":
      return <PhotoGeoField value={(v as PhotoGeoValue) ?? null} onChange={set} workItemId={workItemId} />;
    case "signature":
      return <SignatureField value={(v as PhotoValue) ?? null} onChange={set} workItemId={workItemId} />;
    case "select":
      return (
        <Select value={(v as string) ?? ""} onValueChange={(val) => set(val || null)}>
          <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {(d.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "multiselect": {
      const arr = Array.isArray(v) ? (v as string[]) : [];
      const toggle = (val: string) => set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
      return (
        <div className="space-y-1 rounded-md border border-input p-2">
          {(d.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={arr.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
          {arr.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {arr.map((x) => <Badge key={x} variant="secondary" className="text-xs">{x}</Badge>)}
            </div>
          )}
        </div>
      );
    }
    default:
      return <Input value={(v as string) ?? ""} onChange={(e) => set(e.target.value || null)} />;
  }
}
