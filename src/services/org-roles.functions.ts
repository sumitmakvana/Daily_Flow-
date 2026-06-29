import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

export type OrgRole = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
};

export type OrgRoleHierarchy = { parent_role_id: string; child_role_id: string };
export type UserOrgRole = { id: string; user_id: string; role_id: string };

const ROLE_COLS = `id, key, label, description, sort_order, is_system, is_active`;

export const listOrgRolesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { includeInactive?: boolean }) =>
    z.object({ includeInactive: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<OrgRole>(
        data.includeInactive
          ? `SELECT ${ROLE_COLS} FROM public.org_roles ORDER BY sort_order`
          : `SELECT ${ROLE_COLS} FROM public.org_roles WHERE is_active = true ORDER BY sort_order`,
      );
      return res.rows;
    });
    return rows;
  });

export const createOrgRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { key: string; label: string; description?: string; sort_order?: number }) =>
      z
        .object({
          key: z.string().min(1),
          label: z.string().min(1),
          description: z.string().optional(),
          sort_order: z.number().int().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<OrgRole>(
        `INSERT INTO public.org_roles (key, label, description, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING ${ROLE_COLS}`,
        [data.key, data.label, data.description ?? null, data.sort_order ?? 100],
      );
      return res.rows[0];
    });
    return row;
  });

export const updateOrgRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      patch: Partial<Pick<OrgRole, "label" | "description" | "sort_order" | "is_active">>;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          patch: z
            .object({
              label: z.string().optional(),
              description: z.string().nullish(),
              sort_order: z.number().int().optional(),
              is_active: z.boolean().optional(),
            })
            .strict(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = $${i++}`);
      params.push(v);
    }
    if (!sets.length) return { ok: true };
    params.push(data.id);
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.org_roles SET ${sets.join(", ")} WHERE id = $${i}`,
        params,
      );
    });
    return { ok: true };
  });

export const listOrgRoleHierarchyFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<OrgRoleHierarchy>(
        `SELECT parent_role_id, child_role_id FROM public.org_role_hierarchy`,
      );
      return res.rows;
    });
    return rows;
  });

export const setOrgRoleParentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { child_role_id: string; parent_role_id: string | null }) =>
    z
      .object({
        child_role_id: z.string().uuid(),
        parent_role_id: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `DELETE FROM public.org_role_hierarchy WHERE child_role_id = $1`,
        [data.child_role_id],
      );
      if (data.parent_role_id) {
        await client.query(
          `INSERT INTO public.org_role_hierarchy (parent_role_id, child_role_id)
           VALUES ($1, $2)`,
          [data.parent_role_id, data.child_role_id],
        );
      }
    });
    return { ok: true };
  });

export const listOrgRoleMembersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { role_id: string }) =>
    z.object({ role_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<UserOrgRole>(
        `SELECT id, user_id, role_id FROM public.user_org_roles WHERE role_id = $1`,
        [data.role_id],
      );
      return res.rows;
    });
    return rows;
  });

export const assignOrgRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role_id: string }) =>
    z
      .object({ user_id: z.string().uuid(), role_id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `INSERT INTO public.user_org_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [data.user_id, data.role_id],
      );
    });
    return { ok: true };
  });

export const unassignOrgRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role_id: string }) =>
    z
      .object({ user_id: z.string().uuid(), role_id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `DELETE FROM public.user_org_roles
           WHERE user_id = $1 AND role_id = $2`,
        [data.user_id, data.role_id],
      );
    });
    return { ok: true };
  });

export const myOrgRoleKeysFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<{ key: string }>(
        `SELECT r.key
           FROM public.user_org_roles uor
           JOIN public.org_roles r ON r.id = uor.role_id
           WHERE uor.user_id = $1`,
        [context.userId],
      );
      return res.rows;
    });
    return rows.map((r) => r.key);
  });
