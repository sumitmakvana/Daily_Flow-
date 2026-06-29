import {
  listConfigSnapshotsFn,
  snapshotConfigFn,
  restoreConfigFn,
  deleteConfigSnapshotFn,
} from "./config-snapshots.functions";

export type ConfigSnapshot = {
  id: string;
  kind: "manual" | "pre_install" | "pre_import" | "pre_restore";
  label: string;
  payload: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export const configSnapshotsService = {
  async list(): Promise<ConfigSnapshot[]> {
    return (await listConfigSnapshotsFn()) as ConfigSnapshot[];
  },

  async snapshot(
    label: string,
    kind: ConfigSnapshot["kind"] = "manual",
  ): Promise<string> {
    const { id } = await snapshotConfigFn({ data: { label, kind } });
    return id;
  },

  async restore(snapshotId: string): Promise<void> {
    await restoreConfigFn({ data: { snapshotId } });
  },

  async download(snap: ConfigSnapshot): Promise<void> {
    const blob = new Blob([JSON.stringify(snap.payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `config-${snap.label.replace(/\s+/g, "-").toLowerCase()}-${snap.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async delete(id: string): Promise<void> {
    await deleteConfigSnapshotFn({ data: { id } });
  },
};
