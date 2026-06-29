import { fetchActiveNudges, markNudgeRead, dismissNudge } from "./nudges.functions";
import type { Nudge } from "@/lib/types";

export const nudgesService = {
  async listActive(userId: string): Promise<Nudge[]> {
    return fetchActiveNudges({ data: { userId } });
  },

  async markRead(id: string) {
    await markNudgeRead({ data: { id } });
  },

  async dismiss(id: string) {
    await dismissNudge({ data: { id } });
  },

  async generateNow() {
    const res = await fetch("/api/public/hooks/generate-nudges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: "{}",
    });
    return res.ok;
  },
};
