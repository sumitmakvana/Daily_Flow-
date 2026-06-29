import type { WorkItemType } from "@/lib/types";
import {
  listWorkItemTypesFn,
  createWorkItemTypeFn,
  updateWorkItemTypeFn,
  setWorkItemTypeActiveFn,
} from "./work-item-types.functions";

export type WorkItemTypeInput = {
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  sort_order?: number;
  id_prefix?: string | null;
};

export const workItemTypesService = {
  async list(includeInactive = false): Promise<WorkItemType[]> {
    return await listWorkItemTypesFn({ data: { includeInactive } });
  },

  async create(input: WorkItemTypeInput): Promise<WorkItemType> {
    return await createWorkItemTypeFn({ data: input });
  },

  async update(
    id: string,
    patch: Partial<WorkItemTypeInput> & { active?: boolean },
  ): Promise<WorkItemType> {
    return await updateWorkItemTypeFn({ data: { id, patch } });
  },

  async setActive(id: string, active: boolean): Promise<void> {
    await setWorkItemTypeActiveFn({ data: { id, active } });
  },
};
