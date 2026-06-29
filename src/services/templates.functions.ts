import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

export const listTemplatesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT id, key, name, industry, version, description,
                is_installed, installed_at, installed_by
           FROM public.industry_templates
           ORDER BY industry, name`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const listTemplateComponentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { templateId: string }) =>
    z.object({ templateId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT id, template_id, component_kind, payload, apply_order
           FROM public.template_components
           WHERE template_id = $1
           ORDER BY apply_order`,
        [data.templateId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const installTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { templateId: string }) =>
    z.object({ templateId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`SELECT public.install_template($1)`, [data.templateId]);
    });
    return { ok: true };
  });
