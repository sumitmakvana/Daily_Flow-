import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAsUser, withUser } from "@/integrations/postgres/query.server";

export const fetchActiveAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Returns active announcements active for the current date
    return selectAsUser<any>(
      context.userId,
      `SELECT id, title, message, emoji, theme_color, image_url, start_date::text, end_date::text, is_active
       FROM public.announcements
       WHERE is_active = true
         AND start_date <= CURRENT_DATE
         AND end_date >= CURRENT_DATE
       ORDER BY created_at DESC`
    );
  });

export const fetchAllAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return selectAsUser<any>(
      context.userId,
      `SELECT id, title, message, emoji, theme_color, image_url, start_date::text, end_date::text, is_active
       FROM public.announcements
       ORDER BY start_date DESC, created_at DESC`
    );
  });

export const createAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { 
    title: string; 
    message: string; 
    emoji: string; 
    theme_color: string; 
    start_date: string; 
    end_date: string; 
    image_url: string | null; 
    is_active: boolean; 
  }) => z.object({
    title: z.string(),
    message: z.string(),
    emoji: z.string(),
    theme_color: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    image_url: z.string().nullable(),
    is_active: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    // Only admins should create announcements
    const adminCheck = await selectAsUser<any>(
      context.userId,
      `SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
      [context.userId]
    );
    if (adminCheck.length === 0) {
      throw new Error("Unauthorized: Only admins can manage announcements");
    }

    await withUser(context.userId, async (client) => {
      await client.query(
        `INSERT INTO public.announcements (title, message, emoji, theme_color, start_date, end_date, image_url, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.title, data.message, data.emoji, data.theme_color, data.start_date, data.end_date, data.image_url, data.is_active]
      );
    });
    return { ok: true };
  });

export const deleteAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    // Only admins should delete announcements
    const adminCheck = await selectAsUser<any>(
      context.userId,
      `SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
      [context.userId]
    );
    if (adminCheck.length === 0) {
      throw new Error("Unauthorized: Only admins can manage announcements");
    }

    await withUser(context.userId, async (client) => {
      await client.query(
        `DELETE FROM public.announcements WHERE id = $1`,
        [data.id]
      );
    });
    return { ok: true };
  });
