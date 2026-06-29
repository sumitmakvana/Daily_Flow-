import type { WorkSettings, UserStreak, Team, Project, HolidayCalendar } from "@/lib/types";
import {
  getWorkSettingsFn,
  updateWorkSettingsFn,
  getStreakForUserFn,
  listAllStreaksFn,
  listTeamsFn,
  createTeamFn,
  deleteTeamFn,
  listProjectsFn,
  createProjectFn,
  listHolidaysFn,
  addHolidayFn,
  removeHolidayFn,
} from "./operations.functions";

export const workSettingsService = {
  async get(): Promise<WorkSettings> {
    const row = (await getWorkSettingsFn()) as WorkSettings | null;
    return (
      row ?? ({ id: 1, workdays: [1, 2, 3, 4, 5], daily_capacity_hours: 8, sla_default_days: 3 } as unknown as WorkSettings)
    );
  },
  async update(patch: Partial<WorkSettings>) {
    await updateWorkSettingsFn({ data: { patch: patch as Record<string, unknown> } });
  },
};

export const streaksService = {
  async forUser(userId: string): Promise<UserStreak | null> {
    return (await getStreakForUserFn({ data: { userId } })) as UserStreak | null;
  },
  async all(): Promise<UserStreak[]> {
    return (await listAllStreaksFn()) as UserStreak[];
  },
};

export const teamsService = {
  async list(): Promise<Team[]> {
    return (await listTeamsFn()) as Team[];
  },
  async create(t: Omit<Team, "id">) {
    await createTeamFn({ data: { team: t as unknown as Record<string, unknown> } });
  },
  async delete(id: string) {
    await deleteTeamFn({ data: { id } });
  },
};

export const projectsService = {
  async list(): Promise<Project[]> {
    return (await listProjectsFn()) as Project[];
  },
  async create(p: Omit<Project, "id">) {
    await createProjectFn({ data: { project: p as unknown as Record<string, unknown> } });
  },
};

export const holidaysService = {
  async list(): Promise<HolidayCalendar[]> {
    return (await listHolidaysFn()) as HolidayCalendar[];
  },
  async add(calendar_date: string, label: string) {
    await addHolidayFn({ data: { calendar_date, label } });
  },
  async remove(id: string) {
    await removeHolidayFn({ data: { id } });
  },
};
