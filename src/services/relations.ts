import {
  listRelationsFn,
  linkRelationFn,
  unlinkRelationFn,
  type RelationKind,
  type WorkItemRelation,
} from "./relations.functions";

export type { RelationKind, WorkItemRelation };

export const relationsService = {
  async listForItem(workItemId: string): Promise<WorkItemRelation[]> {
    return await listRelationsFn({ data: { workItemId } });
  },

  async link(
    fromId: string,
    toId: string,
    kind: RelationKind,
  ): Promise<WorkItemRelation> {
    return await linkRelationFn({ data: { fromId, toId, kind } });
  },

  async unlink(id: string): Promise<void> {
    await unlinkRelationFn({ data: { id } });
  },
};
