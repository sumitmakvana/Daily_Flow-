import type { NotificationPrefs } from "@/lib/types";
import { getNotifPrefsFn, saveNotifPrefsFn } from "./notif-prefs.functions";

const DEFAULTS = (userId: string): NotificationPrefs => ({
  user_id: userId,
  digest_enabled: true,
  eod_reminder_hour: 16,
  notify_assignment: true,
  notify_priority_change: true,
  notify_blocker_resolved: true,
  notify_manager_overload: true,
  notify_manager_delays: true,
});

export const notifPrefsService = {
  async get(userId: string): Promise<NotificationPrefs> {
    const row = await getNotifPrefsFn({ data: { userId } });
    return row ?? DEFAULTS(userId);
  },

  async save(prefs: NotificationPrefs): Promise<NotificationPrefs> {
    return await saveNotifPrefsFn({ data: prefs });
  },
};
