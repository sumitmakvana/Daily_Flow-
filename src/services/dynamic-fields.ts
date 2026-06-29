import { listFieldDefsFn } from "./dynamic-fields.functions";

export type FieldDataType =
  | "text" | "number" | "date" | "datetime" | "boolean"
  | "select" | "multiselect" | "user" | "url" | "email"
  | "photo" | "geo" | "photo_geo" | "signature";

export type WorkItemFieldDef = {
  id: string;
  type_id: string;
  key: string;
  label: string;
  data_type: FieldDataType;
  required: boolean;
  required_for_completion?: boolean;
  options: Array<{ value: string; label: string }>;
  validation: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
};

/** Accept ["A","B"] or [{value,label}] and return the canonical shape. */
export function normalizeOptions(raw: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      if (typeof o === "string") return { value: o, label: o };
      if (o && typeof o === "object" && "value" in o) {
        const obj = o as { value: unknown; label?: unknown };
        return { value: String(obj.value), label: String(obj.label ?? obj.value) };
      }
      return null;
    })
    .filter((x): x is { value: string; label: string } => !!x);
}

export const dynamicFieldsService = {
  async listDefs(typeId: string): Promise<WorkItemFieldDef[]> {
    const rows = await listFieldDefsFn({ data: { typeId } });
    return rows as unknown as WorkItemFieldDef[];
  },


  /** Mirror of the DB trigger — fail fast in the UI before submit. */
  validate(
    defs: WorkItemFieldDef[],
    values: Record<string, unknown>
  ): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    const allowed = new Set(defs.map((d) => d.key));

    for (const k of Object.keys(values)) {
      if (!allowed.has(k)) errors.push(`Unknown field "${k}"`);
    }
    for (const d of defs) {
      const v = values[d.key];
      if (d.required && (v === undefined || v === null || v === "")) {
        errors.push(`"${d.label}" is required`);
        continue;
      }
      if (v === undefined || v === null) continue;
      switch (d.data_type) {
        case "number":
          if (typeof v !== "number") errors.push(`"${d.label}" must be a number`);
          break;
        case "boolean":
          if (typeof v !== "boolean") errors.push(`"${d.label}" must be true/false`);
          break;
        case "multiselect":
          if (!Array.isArray(v)) errors.push(`"${d.label}" must be a list`);
          break;
        case "photo":
        case "signature":
          if (typeof v !== "object" || !(v as Record<string, unknown>).attachment_id)
            errors.push(`"${d.label}" needs a capture`);
          break;
        case "geo":
          if (typeof v !== "object" || (v as Record<string, unknown>).lat == null || (v as Record<string, unknown>).lng == null)
            errors.push(`"${d.label}" needs a location`);
          break;
        case "photo_geo":
          if (typeof v !== "object"
              || !(v as Record<string, unknown>).attachment_id
              || (v as Record<string, unknown>).lat == null
              || (v as Record<string, unknown>).lng == null)
            errors.push(`"${d.label}" needs both photo and location`);
          break;
        default:
          if (typeof v !== "string" && typeof v !== "number")
            errors.push(`"${d.label}" must be a string`);
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },
};
