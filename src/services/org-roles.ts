import {
  listOrgRolesFn,
  createOrgRoleFn,
  updateOrgRoleFn,
  listOrgRoleHierarchyFn,
  setOrgRoleParentFn,
  listOrgRoleMembersFn,
  assignOrgRoleFn,
  unassignOrgRoleFn,
  myOrgRoleKeysFn,
  type OrgRole,
  type OrgRoleHierarchy,
  type UserOrgRole,
} from "./org-roles.functions";

export type { OrgRole, OrgRoleHierarchy, UserOrgRole };

export const orgRolesService = {
  async list(includeInactive = false): Promise<OrgRole[]> {
    return await listOrgRolesFn({ data: { includeInactive } });
  },

  async create(input: {
    key: string;
    label: string;
    description?: string;
    sort_order?: number;
  }): Promise<OrgRole> {
    return await createOrgRoleFn({ data: input });
  },

  async update(
    id: string,
    patch: Partial<Pick<OrgRole, "label" | "description" | "sort_order" | "is_active">>,
  ): Promise<void> {
    await updateOrgRoleFn({ data: { id, patch } });
  },

  async listHierarchy(): Promise<OrgRoleHierarchy[]> {
    return await listOrgRoleHierarchyFn();
  },

  async setParent(
    child_role_id: string,
    parent_role_id: string | null,
  ): Promise<void> {
    await setOrgRoleParentFn({ data: { child_role_id, parent_role_id } });
  },

  async listMembers(role_id: string): Promise<UserOrgRole[]> {
    return await listOrgRoleMembersFn({ data: { role_id } });
  },

  async assign(user_id: string, role_id: string): Promise<void> {
    await assignOrgRoleFn({ data: { user_id, role_id } });
  },

  async unassign(user_id: string, role_id: string): Promise<void> {
    await unassignOrgRoleFn({ data: { user_id, role_id } });
  },

  async myRoleKeys(): Promise<string[]> {
    return await myOrgRoleKeysFn();
  },
};
