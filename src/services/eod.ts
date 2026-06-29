import type { EodCheckin } from "@/lib/types";
import { todayISO } from "@/lib/format";
import {
  getEodTodayFn,
  upsertEodFn,
  listEodForDateFn,
} from "./eod.functions";

export const eodService = {
  async getToday(userId: string): Promise<EodCheckin | null> {
    return await getEodTodayFn({ data: { userId, date: todayISO() } });
  },

  async upsert(
    userId: string,
    patch: Partial<EodCheckin>,
  ): Promise<EodCheckin> {
    return await upsertEodFn({
      data: { userId, checkinDate: todayISO(), patch },
    });
  },

  async listForDate(date: string): Promise<EodCheckin[]> {
    return await listEodForDateFn({ data: { date } });
  },
};
