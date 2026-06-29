import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const fetchCurrentConfigFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const payload = await withUser(context.userId, async (client) => {
      const [types, statuses, transitions, fields, chains, steps, roles, hier] =
        await Promise.all([
          client.query(`SELECT * FROM public.work_item_types`),
          client.query(`SELECT * FROM public.work_item_statuses`),
          client.query(`SELECT * FROM public.work_item_transitions`),
          client.query(`SELECT * FROM public.work_item_field_defs`),
          client.query(`SELECT * FROM public.approval_chains`),
          client.query(`SELECT * FROM public.approval_steps`),
          client.query(`SELECT * FROM public.org_roles`),
          client.query(`SELECT * FROM public.org_role_hierarchy`),
        ]);
      return {
        version: 1,
        captured_at: new Date().toISOString(),
        work_item_types: types.rows,
        work_item_statuses: statuses.rows,
        work_item_transitions: transitions.rows,
        work_item_field_defs: fields.rows,
        approval_chains: chains.rows,
        approval_steps: steps.rows,
        org_roles: roles.rows,
        org_role_hierarchy: hier.rows,
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return payload as any;
  });

export const importConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { payload: Record<string, unknown> }) =>
    z.object({ payload: z.record(z.string(), z.unknown()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const p = data.payload as {
      work_item_types?: Row[];
      work_item_statuses?: Row[];
      work_item_transitions?: Row[];
      work_item_field_defs?: Row[];
      org_roles?: Row[];
    };

    await withUser(context.userId, async (client) => {
      // 0. Auto-snapshot first (same transaction as import would defeat purpose; do separately)
      await client.query(
        `SELECT public.snapshot_config($1, 'pre_import')`,
        [`Auto: before import ${new Date().toLocaleString()}`],
      );

      // 1. Roles
      for (const r of p.org_roles ?? []) {
        await client.query(
          `INSERT INTO public.org_roles (key, label, description, sort_order, is_active)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (key) DO UPDATE SET
             label = EXCLUDED.label,
             description = EXCLUDED.description,
             sort_order = EXCLUDED.sort_order,
             is_active = EXCLUDED.is_active`,
          [r.key, r.label, r.description ?? null, r.sort_order ?? 100, r.is_active ?? true],
        );
      }

      // 2. Types
      const typeIdByKey = new Map<string, string>();
      for (const t of p.work_item_types ?? []) {
        const res = await client.query<{ id: string; key: string }>(
          `INSERT INTO public.work_item_types
             (key, name, description, icon, color, sort_order, active, id_prefix)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (key) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             icon = EXCLUDED.icon,
             color = EXCLUDED.color,
             sort_order = EXCLUDED.sort_order,
             active = EXCLUDED.active,
             id_prefix = EXCLUDED.id_prefix
           RETURNING id, key`,
          [
            t.key,
            t.name,
            t.description ?? null,
            t.icon ?? null,
            t.color ?? null,
            t.sort_order ?? 100,
            t.active ?? true,
            t.id_prefix ?? null,
          ],
        );
        if (res.rows[0]) typeIdByKey.set(res.rows[0].key, res.rows[0].id);
      }

      const oldTypeKeyById = new Map<string, string>();
      for (const t of p.work_item_types ?? []) oldTypeKeyById.set(t.id, t.key);

      // 3. Statuses
      const statusIdByOldId = new Map<string, string>();
      for (const s of p.work_item_statuses ?? []) {
        const typeKey = oldTypeKeyById.get(s.type_id);
        const newTypeId = typeKey ? typeIdByKey.get(typeKey) : undefined;
        if (!newTypeId) continue;
        const res = await client.query<{ id: string }>(
          `INSERT INTO public.work_item_statuses
             (type_id, key, label, category, color, sort_order, is_initial, is_terminal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (type_id, key) DO UPDATE SET
             label = EXCLUDED.label,
             category = EXCLUDED.category,
             color = EXCLUDED.color,
             sort_order = EXCLUDED.sort_order,
             is_initial = EXCLUDED.is_initial,
             is_terminal = EXCLUDED.is_terminal
           RETURNING id`,
          [
            newTypeId,
            s.key,
            s.label,
            s.category,
            s.color ?? null,
            s.sort_order ?? 0,
            s.is_initial ?? false,
            s.is_terminal ?? false,
          ],
        );
        if (res.rows[0]) statusIdByOldId.set(s.id, res.rows[0].id);
      }

      // 4. Field defs
      for (const f of p.work_item_field_defs ?? []) {
        const typeKey = oldTypeKeyById.get(f.type_id);
        const newTypeId = typeKey ? typeIdByKey.get(typeKey) : undefined;
        if (!newTypeId) continue;
        await client.query(
          `INSERT INTO public.work_item_field_defs
             (type_id, key, label, data_type, required, options, validation,
              sort_order, is_active, required_for_completion)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
           ON CONFLICT (type_id, key) DO UPDATE SET
             label = EXCLUDED.label,
             data_type = EXCLUDED.data_type,
             required = EXCLUDED.required,
             options = EXCLUDED.options,
             validation = EXCLUDED.validation,
             sort_order = EXCLUDED.sort_order,
             is_active = EXCLUDED.is_active,
             required_for_completion = EXCLUDED.required_for_completion`,
          [
            newTypeId,
            f.key,
            f.label,
            f.data_type,
            f.required ?? false,
            JSON.stringify(f.options ?? []),
            JSON.stringify(f.validation ?? {}),
            f.sort_order ?? 0,
            f.is_active ?? true,
            f.required_for_completion ?? false,
          ],
        );
      }

      // 5. Transitions
      for (const tr of p.work_item_transitions ?? []) {
        const typeKey = oldTypeKeyById.get(tr.type_id);
        const newTypeId = typeKey ? typeIdByKey.get(typeKey) : undefined;
        if (!newTypeId) continue;
        const newFrom = tr.from_status_id
          ? (statusIdByOldId.get(tr.from_status_id) ?? null)
          : null;
        const newTo = statusIdByOldId.get(tr.to_status_id);
        if (!newTo) continue;
        await client.query(
          `INSERT INTO public.work_item_transitions
             (type_id, from_status_id, to_status_id, label, sort_order,
              guard_expr, required_role_key)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            newTypeId,
            newFrom,
            newTo,
            tr.label,
            tr.sort_order ?? 0,
            JSON.stringify(tr.guard_expr ?? {}),
            tr.required_role_key ?? null,
          ],
        );
      }
    });

    return { ok: true };
  });
