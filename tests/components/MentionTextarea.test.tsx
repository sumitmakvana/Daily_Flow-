import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MentionTextarea } from "@/components/MentionTextarea";
import type { MentionUser } from "@/lib/mentions";

const users: MentionUser[] = [
  { id: "nirav", display_name: "Nirav Thakkar", email: "nirav@noesisanalytics.co.in" },
  { id: "miraj", display_name: "Miraj Shah", email: "miraj.shah@noesisanalytics.co.in" },
  { id: "milan", display_name: "Milan Patel", email: "milan.patel@noesisanalytics.co.in" },
];

function Harness({ onSubmit = () => {}, onCancel }: { onSubmit?: () => void; onCancel?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <MentionTextarea
      aria-label="comment"
      value={value}
      onValueChange={setValue}
      users={users}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

const box = () => screen.getByLabelText("comment") as HTMLTextAreaElement;

describe("MentionTextarea", () => {
  it("shows suggestions with name and email after typing @", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("Nirav Thakkar")).toBeInTheDocument();
    expect(screen.getByText("nirav@noesisanalytics.co.in")).toBeInTheDocument();
  });

  it("filters as you type and closes when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "@mi");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Milan Patel"),
      expect.stringContaining("Miraj Shah"),
    ]);
    await user.type(box(), "zz");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open for an @ inside a word (email)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "a@b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ArrowDown/ArrowUp move the highlight (wrapping) and Enter inserts the active user", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(box(), "@mi");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(box().value).toBe("@Miraj Shah ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Enter selected the suggestion; it must not also have submitted.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("selects with the mouse", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "hi @");
    await user.click(screen.getByText("Nirav Thakkar"));
    expect(box().value).toBe("hi @Nirav Thakkar ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports multiple mentions in one comment", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "@nir");
    await user.keyboard("{Enter}");
    await user.type(box(), "and @mir");
    await user.keyboard("{Enter}");
    expect(box().value).toBe("@Nirav Thakkar and @Miraj Shah ");
  });

  it("Escape closes only the popup, keeps the text, and does not cancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCancel={onCancel} />);
    await user.type(box(), "@mi");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box().value).toBe("@mi");
    expect(onCancel).not.toHaveBeenCalled();
    // A second Escape (no popup) now cancels.
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape never reaches an enclosing dialog's document-level listener (Radix closes modals there)", async () => {
    const docEscape = vi.fn();
    document.addEventListener("keydown", docEscape, true);
    const user = userEvent.setup();
    render(<Harness onCancel={() => {}} />);
    await user.type(box(), "@mi");
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", docEscape, true);
    expect(docEscape.mock.calls.filter(([e]) => (e as KeyboardEvent).key === "Escape")).toHaveLength(0);
  });

  it("renders the popup in a portal with a capped, scrollable height", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.type(box(), "@");
    const list = screen.getByRole("listbox");
    expect(container.contains(list)).toBe(false); // not clipped by ancestors' overflow
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(parseInt(list.style.maxHeight, 10)).toBeLessThanOrEqual(200);
    expect(list.style.position).toBe("fixed");
  });

  it("Enter submits when the popup is closed", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(box(), "hello{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(box().value).toBe("hello");
  });

  it("Shift+Enter inserts a newline and does not submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(box(), "line1{Shift>}{Enter}{/Shift}line2");
    expect(box().value).toBe("line1\nline2");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clicking elsewhere in the text closes the popup instead of reopening it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "@nir");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(box());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Tab also selects the active suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "@nir{Tab}");
    expect(box().value).toBe("@Nirav Thakkar ");
  });
});
