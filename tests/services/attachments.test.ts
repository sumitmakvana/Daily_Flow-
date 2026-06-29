import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { attachmentsService, isAllowedMime } from "@/services/attachments";
import type { Attachment } from "@/lib/types";

const att = (o: Partial<Attachment> = {}): Attachment => ({
  id: "a1",
  work_item_id: "t1",
  file_name: "f.pdf",
  file_size: 100,
  file_type: "application/pdf",
  storage_path: "t1/x-f.pdf",
  uploaded_by: "u1",
  uploaded_at: "2026-01-01T00:00:00Z",
  ...o,
});

describe("services/attachments", () => {
  beforeEach(() => mockSupabase.reset());

  it("isAllowedMime accepts image/pdf/audio/csv/text", () => {
    expect(isAllowedMime("image/png")).toBe(true);
    expect(isAllowedMime("application/pdf")).toBe(true);
    expect(isAllowedMime("audio/mpeg")).toBe(true);
    expect(isAllowedMime("text/csv")).toBe(true);
    expect(isAllowedMime("text/plain")).toBe(true);
    expect(isAllowedMime("application/x-msdownload")).toBe(false);
  });

  it("list returns attachments for a work item", async () => {
    mockSupabase.queueResponse("select", { data: [att()] });
    const items = await attachmentsService.list("t1");
    expect(items).toHaveLength(1);
    expect(mockSupabase.calls.from).toContain("attachments");
  });

  it("list throws on error", async () => {
    mockSupabase.queueResponse("select", { error: { message: "x" } });
    await expect(attachmentsService.list("t1")).rejects.toBeTruthy();
  });

  it("upload rejects oversize files", async () => {
    const big = new File(["x".repeat(10)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await expect(attachmentsService.upload("t1", big, "u1")).rejects.toThrow(/20MB/);
  });

  it("upload rejects unsupported types", async () => {
    const f = new File(["x"], "x.exe", { type: "application/x-msdownload" });
    await expect(attachmentsService.upload("t1", f, "u1")).rejects.toThrow(/Unsupported/);
  });

  it("upload writes to storage then inserts row", async () => {
    mockSupabase.queueResponse("storage", { data: { path: "p" } });
    mockSupabase.queueResponse("insert", { data: att() });
    const f = new File(["hi"], "n.pdf", { type: "application/pdf" });
    Object.defineProperty(f, "size", { value: 2 });
    const out = await attachmentsService.upload("t1", f, "u1");
    expect(out.id).toBe("a1");
    expect(mockSupabase.calls.storage[0].op).toBe("upload");
    expect(mockSupabase.calls.from).toContain("attachments");
  });

  it("upload cleans up storage on db insert failure", async () => {
    mockSupabase.queueResponse("storage", { data: { path: "p" } });
    mockSupabase.queueResponse("insert", { error: { message: "boom" } });
    mockSupabase.queueResponse("storage", { data: null }); // remove
    const f = new File(["hi"], "n.pdf", { type: "application/pdf" });
    Object.defineProperty(f, "size", { value: 2 });
    await expect(attachmentsService.upload("t1", f, "u1")).rejects.toBeTruthy();
    expect(mockSupabase.calls.storage.map((s) => s.op)).toEqual(["upload", "remove"]);
  });

  it("download returns a signed URL", async () => {
    mockSupabase.queueResponse("storage", { data: { signedUrl: "https://x/y" } });
    const url = await attachmentsService.download(att());
    expect(url).toBe("https://x/y");
  });

  it("remove deletes row and storage object", async () => {
    mockSupabase.queueResponse("delete", { data: null });
    mockSupabase.queueResponse("storage", { data: null });
    await attachmentsService.remove(att());
    expect(mockSupabase.calls.ops[0].op).toBe("delete");
    expect(mockSupabase.calls.storage[0].op).toBe("remove");
  });

  it("remove throws when db delete fails", async () => {
    mockSupabase.queueResponse("delete", { error: { message: "x" } });
    await expect(attachmentsService.remove(att())).rejects.toBeTruthy();
  });
});
