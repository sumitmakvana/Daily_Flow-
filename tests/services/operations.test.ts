import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { workSettingsService, streaksService, teamsService, projectsService, holidaysService } from "@/services/operations";

describe("services/operations", () => {
  beforeEach(() => mockSupabase.reset());

  describe("workSettings", () => {
    it("returns defaults when missing", async () => {
      mockSupabase.queueResponse("select", { data: null });
      const s = await workSettingsService.get();
      expect(s.daily_capacity_hours).toBe(8);
    });
    it("returns existing row", async () => {
      mockSupabase.queueResponse("select", { data: { id: 1, daily_capacity_hours: 6, workdays: [1,2,3,4,5], sla_default_days: 5 } });
      const s = await workSettingsService.get();
      expect(s.daily_capacity_hours).toBe(6);
    });
    it("update ok", async () => {
      mockSupabase.queueResponse("update", { data: null });
      await workSettingsService.update({ daily_capacity_hours: 7 });
    });
    it("update throws on error", async () => {
      mockSupabase.queueResponse("update", { error: { message: "x" } });
      await expect(workSettingsService.update({})).rejects.toBeTruthy();
    });
  });

  describe("streaks", () => {
    it("forUser returns row", async () => {
      mockSupabase.queueResponse("select", { data: { user_id: "u", current_streak: 3, longest_streak: 5 } });
      const s = await streaksService.forUser("u");
      expect(s?.current_streak).toBe(3);
    });
    it("forUser returns null", async () => {
      mockSupabase.queueResponse("select", { data: null });
      expect(await streaksService.forUser("u")).toBeNull();
    });
    it("all returns rows", async () => {
      mockSupabase.queueResponse("select", { data: [{ user_id: "u" }] });
      expect(await streaksService.all()).toHaveLength(1);
    });
    it("all returns [] when null", async () => {
      mockSupabase.queueResponse("select", { data: null });
      expect(await streaksService.all()).toEqual([]);
    });
  });

  describe("teams", () => {
    it("list returns rows", async () => {
      mockSupabase.queueResponse("select", { data: [{ id: "t" }] });
      expect(await teamsService.list()).toHaveLength(1);
    });
    it("list returns []", async () => {
      mockSupabase.queueResponse("select", { data: null });
      expect(await teamsService.list()).toEqual([]);
    });
    it("create ok", async () => {
      mockSupabase.queueResponse("insert", { data: null });
      await teamsService.create({ name: "A" } as never);
    });
    it("create throws", async () => {
      mockSupabase.queueResponse("insert", { error: { message: "x" } });
      await expect(teamsService.create({} as never)).rejects.toBeTruthy();
    });
    it("delete ok", async () => {
      mockSupabase.queueResponse("delete", { data: null });
      await teamsService.delete("t1");
    });
    it("delete throws", async () => {
      mockSupabase.queueResponse("delete", { error: { message: "x" } });
      await expect(teamsService.delete("t")).rejects.toBeTruthy();
    });
  });

  describe("projects", () => {
    it("list returns rows", async () => {
      mockSupabase.queueResponse("select", { data: [{ id: "p" }] });
      expect(await projectsService.list()).toHaveLength(1);
    });
    it("list returns []", async () => {
      mockSupabase.queueResponse("select", { data: null });
      expect(await projectsService.list()).toEqual([]);
    });
    it("create ok", async () => {
      mockSupabase.queueResponse("insert", { data: null });
      await projectsService.create({ name: "P" } as never);
    });
    it("create throws", async () => {
      mockSupabase.queueResponse("insert", { error: { message: "x" } });
      await expect(projectsService.create({} as never)).rejects.toBeTruthy();
    });
  });

  describe("holidays", () => {
    it("list ok", async () => {
      mockSupabase.queueResponse("select", { data: [{ id: "h" }] });
      expect(await holidaysService.list()).toHaveLength(1);
    });
    it("list returns []", async () => {
      mockSupabase.queueResponse("select", { data: null });
      expect(await holidaysService.list()).toEqual([]);
    });
    it("add ok", async () => {
      mockSupabase.queueResponse("insert", { data: null });
      await holidaysService.add("2026-12-25", "Xmas");
    });
    it("add throws", async () => {
      mockSupabase.queueResponse("insert", { error: { message: "x" } });
      await expect(holidaysService.add("d", "l")).rejects.toBeTruthy();
    });
    it("remove ok", async () => {
      mockSupabase.queueResponse("delete", { data: null });
      await holidaysService.remove("h1");
    });
    it("remove throws", async () => {
      mockSupabase.queueResponse("delete", { error: { message: "x" } });
      await expect(holidaysService.remove("h")).rejects.toBeTruthy();
    });
  });
});
