import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const svc = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  mentionableUsers: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/services/comments", () => ({ commentsService: svc }));
vi.mock("@/services/attachments", () => ({ attachmentsService: { upload: vi.fn() } }));
vi.mock("sonner", () => ({ toast }));

import { CommentsPanel } from "@/components/CommentsPanel";
import type { Profile } from "@/lib/types";

const ME = "me";
const profiles: Profile[] = [
  { id: ME, display_name: "Sumit Makwana", avatar_url: null },
  { id: "nirav", display_name: "Nirav Thakkar", avatar_url: null },
  { id: "miraj", display_name: "Miraj Shah", avatar_url: null },
];
const mentionable = [
  { id: ME, display_name: "Sumit Makwana", email: "sumit@noesisanalytics.co.in", avatar_url: null },
  { id: "nirav", display_name: "Nirav Thakkar", email: "nirav@noesisanalytics.co.in", avatar_url: null },
  { id: "miraj", display_name: "Miraj Shah", email: "miraj.shah@noesisanalytics.co.in", avatar_url: null },
];

const saved = (over: Record<string, unknown> = {}) => ({
  id: "c-new", work_item_id: "t1", parent_comment_id: null, user_id: ME, body: "x",
  created_at: new Date().toISOString(), edited_at: null, deleted_at: null, mentions: [], ...over,
});

function renderPanel() {
  return render(<CommentsPanel workItemId="t1" userId={ME} profiles={profiles} canModerate={false} />);
}

const composer = () => screen.getByPlaceholderText(/Add a comment/) as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
  svc.list.mockResolvedValue([]);
  svc.mentionableUsers.mockResolvedValue(mentionable);
  svc.add.mockImplementation(async (o: any) => saved({ body: o.body, mentions: o.mentionUserIds }));
  svc.edit.mockResolvedValue(undefined);
});

describe("CommentsPanel mentions", () => {
  it("opens the user popup on @ with name and email, then submits the mentions on Enter", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("No comments yet.");
    await waitFor(() => expect(svc.mentionableUsers).toHaveBeenCalled());

    await user.type(composer(), "@nir");
    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("nirav@noesisanalytics.co.in")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(composer().value).toBe("@Nirav Thakkar ");
    expect(svc.add).not.toHaveBeenCalled(); // Enter chose the suggestion, it did not submit

    await user.type(composer(), "and @mir");
    await user.keyboard("{Enter}");
    await user.type(composer(), "please review{Enter}");

    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: "t1",
        body: "@Nirav Thakkar and @Miraj Shah please review",
        parentId: null,
        mentionUserIds: ["nirav", "miraj"],
      }),
    );
    await waitFor(() => expect(composer().value).toBe(""));
  });

  it("never mentions the author or someone whose @name was deleted from the draft", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(svc.mentionableUsers).toHaveBeenCalled());
    await user.type(composer(), "@sum{Enter}");
    await user.type(composer(), "@nir{Enter}");
    await user.type(composer(), "{Backspace}".repeat("@Nirav Thakkar ".length) + "hi{Enter}");
    await waitFor(() => expect(svc.add).toHaveBeenCalled());
    expect(svc.add.mock.calls[0][0].mentionUserIds).toEqual([]);
  });

  it("Shift+Enter adds a new line without submitting", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "one{Shift>}{Enter}{/Shift}two");
    expect(composer().value).toBe("one\ntwo");
    expect(svc.add).not.toHaveBeenCalled();
  });

  it("submits only once on a rapid double Enter", async () => {
    let resolve!: (v: unknown) => void;
    svc.add.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "hello");
    await user.keyboard("{Enter}{Enter}");
    await user.click(screen.getByRole("button", { name: /Post Comment/ }));
    expect(svc.add).toHaveBeenCalledTimes(1);
    resolve(saved({ body: "hello" }));
    await waitFor(() => expect(composer().value).toBe(""));
  });

  it("keeps the draft and shows the error when posting fails, and allows a retry", async () => {
    svc.add.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    renderPanel();
    await user.type(composer(), "important text{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("network down"));
    expect(composer().value).toBe("important text");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(composer().value).toBe(""));
  });

  it("falls back to the profiles prop when the user lookup fails", async () => {
    svc.mentionableUsers.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(svc.mentionableUsers).toHaveBeenCalled());
    await user.type(composer(), "@mir");
    expect(await screen.findByText("Miraj Shah")).toBeInTheDocument();
  });

  it("highlights mentions in rendered comments", async () => {
    svc.list.mockResolvedValue([
      saved({ id: "c1", user_id: "nirav", body: "ping @Miraj Shah today", mentions: ["miraj"] }),
    ]);
    renderPanel();
    const hl = await screen.findByText("@Miraj Shah");
    expect(hl.tagName).toBe("SPAN");
    expect(hl.className).toMatch(/text-primary/);
  });

  it("reply: mentions and parent id are sent, and the main draft is untouched", async () => {
    svc.list.mockResolvedValue([saved({ id: "c1", user_id: "nirav", body: "root", mentions: [] })]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("root");
    await user.type(composer(), "main draft");
    await user.click(screen.getByRole("button", { name: /Reply/ }));
    const replyBox = await screen.findByPlaceholderText(/^Reply/);
    await user.type(replyBox, "@mir");
    await user.keyboard("{Enter}");
    await user.type(replyBox, "thanks{Enter}");
    await waitFor(() => expect(svc.add).toHaveBeenCalled());
    expect(svc.add).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "c1", body: "@Miraj Shah thanks", mentionUserIds: ["miraj"] }),
    );
    await waitFor(() => expect(composer().value).toBe("main draft"));
  });

  it("edit: Enter saves with the re-resolved mentions, Escape cancels", async () => {
    svc.list.mockResolvedValue([
      saved({ id: "c1", user_id: ME, body: "hi @Nirav Thakkar", mentions: ["nirav"] }),
    ]);
    const user = userEvent.setup();
    const { container } = renderPanel();
    await screen.findByText("@Nirav Thakkar");
    await waitFor(() => expect(svc.mentionableUsers).toHaveBeenCalled());
    const pencil = container.querySelector("svg.lucide-pencil")!.closest("button")!;
    await user.click(pencil);
    const box = screen.getByDisplayValue("hi @Nirav Thakkar") as HTMLTextAreaElement;
    await user.type(box, " and @mir");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(svc.edit).toHaveBeenCalledTimes(1));
    expect(svc.edit).toHaveBeenCalledWith("c1", "hi @Nirav Thakkar and @Miraj Shah ", ["nirav", "miraj"]);

    // Escape cancels edit mode
    await user.click(container.querySelector("svg.lucide-pencil")!.closest("button")!);
    await user.type(screen.getByDisplayValue(/hi @Nirav/), "{Escape}");
    expect(screen.queryByDisplayValue(/hi @Nirav/)).not.toBeInTheDocument();
  });

  it("edit failure keeps edit mode and the typed text", async () => {
    svc.edit.mockRejectedValueOnce(new Error("boom"));
    svc.list.mockResolvedValue([saved({ id: "c1", user_id: ME, body: "orig", mentions: [] })]);
    const user = userEvent.setup();
    const { container } = renderPanel();
    await screen.findByText("orig");
    await user.click(container.querySelector("svg.lucide-pencil")!.closest("button")!);
    const box = screen.getByDisplayValue("orig");
    await user.type(box, " more{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    expect(screen.getByDisplayValue("orig more")).toBeInTheDocument();
  });
});
