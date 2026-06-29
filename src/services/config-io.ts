import { fetchCurrentConfigFn, importConfigFn } from "./config-io.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConfigPayload = {
  version: number;
  captured_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  work_item_types: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  work_item_statuses: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  work_item_transitions: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  work_item_field_defs: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approval_chains: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approval_steps: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  org_roles: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  org_role_hierarchy: any[];
};

export type ImportDiff = {
  types: { added: number; updated: number };
  statuses: { added: number; updated: number };
  fields: { added: number; updated: number };
  roles: { added: number; updated: number };
};

export const configIoService = {
  async exportConfig(): Promise<void> {
    const payload = (await fetchCurrentConfigFn()) as ConfigPayload;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `config-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  validate(json: unknown): ConfigPayload {
    if (!json || typeof json !== "object") throw new Error("Invalid file: not a JSON object");
    const j = json as Record<string, unknown>;
    if (!Array.isArray(j.work_item_types)) throw new Error("Invalid file: missing work_item_types");
    if (!Array.isArray(j.work_item_statuses)) throw new Error("Invalid file: missing work_item_statuses");
    return json as ConfigPayload;
  },

  async previewImport(payload: ConfigPayload): Promise<ImportDiff> {
    const current = (await fetchCurrentConfigFn()) as ConfigPayload;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keysOf = (rows: any[], k = "key") =>
      new Set(rows.map((r) => r[k]).filter(Boolean));
    const curTypes = keysOf(current.work_item_types);
    const curRoles = keysOf(current.org_roles);

    const newTypes = payload.work_item_types.filter((t) => !curTypes.has(t.key)).length;
    const updTypes = payload.work_item_types.filter((t) => curTypes.has(t.key)).length;
    const newRoles = payload.org_roles.filter((r) => !curRoles.has(r.key)).length;
    const updRoles = payload.org_roles.filter((r) => curRoles.has(r.key)).length;

    return {
      types: { added: newTypes, updated: updTypes },
      statuses: { added: payload.work_item_statuses.length, updated: 0 },
      fields: { added: payload.work_item_field_defs.length, updated: 0 },
      roles: { added: newRoles, updated: updRoles },
    };
  },

  async importConfig(payload: ConfigPayload): Promise<void> {
    const validated = this.validate(payload);
    await importConfigFn({
      data: { payload: validated as unknown as Record<string, unknown> },
    });
  },

  async importFromFile(file: File): Promise<ConfigPayload> {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return this.validate(parsed);
  },
};
