import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ReviewerDecision, Task, TaskReview } from "@/lib/types";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => undefined,
  },
}));

let cycle: Partial<TaskReview> | null = null;
vi.mock("@/services/reviews", () => ({
  reviewsService: { listForTask: vi.fn(async () => (cycle ? [cycle] : [])) },
}));

import { ReviewPanel } from "@/components/review/ReviewPanel";
import { ReviewProgress } from "@/components/review/ReviewProgress";

const R1 = "r1";
const R2 = "r2";
const R3 = "r3";
const M = "m";
const profiles = [
  { id: R1, display_name: "Rita" },
  { id: R2, display_name: "Rob" },
  { id: R3, display_name: "Ravi" },
  { id: M, display_name: "Max" },
];

const dec = (
  reviewer_id: string,
  decision: ReviewerDecision["decision"] = "pending",
  extra: Partial<ReviewerDecision> = {},
): ReviewerDecision => ({
  reviewer_id,
  decision,
  decided_by: decision === "pending" ? null : reviewer_id,
  decided_at: decision === "pending" ? null : "2026-10-26T14:30:00",
  feedback: null,
  ...extra,
});

const task = (over: Partial<Task> = {}) =>
  ({
    id: "t1",
    status: "In Review",
    // submitted a few minutes ago, so it is not flagged as waiting
    review_submitted_at: new Date(Date.now() - 5 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
    actual_hours: 2,
    system_hours: 2 + 55 / 60,
    ...over,
  }) as Task;

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

/** The value element ("dd") that belongs to a label ("dt"). */
const stat = (label: string) => {
  const dt = screen.getByText(label, { selector: "dt" });
  return dt.parentElement!.querySelector("dd") as HTMLElement;
};

describe("ReviewPanel", () => {
  beforeEach(() => {
    cycle = {
      id: "c1",
      cycle_no: 1,
      decision: "pending",
      reviewers: [dec(R1, "approved"), dec(R2), dec(R3, "changes_requested")],
    };
  });

  it("shows submission time, waiting time, logged hours, timer and the gap", () => {
    wrap(<ReviewPanel task={task()} profiles={profiles} />);
    expect(stat("Submitted").textContent).toMatch(/\d{1,2} \w{3}/);
    expect(stat("Waiting").textContent).toBe("5m");
    expect(stat("Logged").textContent).toBe("2h");
    expect(stat("Timer").textContent).toBe("2h 55m");
    expect(stat("Timer gap").textContent).toBe("+55m");
  });

  it("explains the gap in a tooltip", () => {
    wrap(<ReviewPanel task={task()} profiles={profiles} />);
    expect(stat("Timer gap").parentElement).toHaveAttribute(
      "title",
      expect.stringMatching(/timer tracked 55m more than was logged/i),
    );
  });

  it("calls out missing logged hours instead of showing a misleading 0h", () => {
    wrap(<ReviewPanel task={task({ actual_hours: 0 })} profiles={profiles} />);
    expect(stat("Logged").textContent).toBe("Missing");
    expect(stat("Logged")).toHaveClass("text-amber-400");
    expect(stat("Timer gap").textContent).toBe("—");
  });

  it("highlights a large gap and a review that has waited more than a day", () => {
    wrap(
      <ReviewPanel
        task={task({
          actual_hours: 1,
          system_hours: 4,
          review_submitted_at: new Date(Date.now() - 30 * 3600000).toISOString(),
        })}
        profiles={profiles}
      />,
    );
    expect(stat("Timer gap")).toHaveClass("text-amber-400");
    expect(stat("Waiting")).toHaveClass("text-amber-400");
    expect(screen.getByText("Waiting 1d 6h")).toBeInTheDocument();
  });

  it("shows every reviewer on their own row with their own status", async () => {
    wrap(<ReviewPanel task={task()} profiles={profiles} />);
    await waitFor(() => expect(screen.getByText("Rita")).toBeInTheDocument());
    expect(screen.getByText(/1\/3 approved/)).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Rita")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Approved/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Waiting/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Changes requested/)).toBeInTheDocument();
  });

  it("shows the round number only after the first review round", async () => {
    cycle = { ...cycle, cycle_no: 3 };
    wrap(<ReviewPanel task={task()} profiles={profiles} />);
    await waitFor(() => expect(screen.getByText(/round 3/)).toBeInTheDocument());
  });

  it("puts the actions in a footer that hides itself when there are none", () => {
    wrap(
      <ReviewPanel task={task()} profiles={profiles}>
        <button>Approve</button>
      </ReviewPanel>,
    );
    const footer = screen.getByRole("button", { name: "Approve" }).parentElement as HTMLElement;
    expect(footer).toHaveClass("empty:hidden");
  });

  it("renders nothing for tasks that are not in review (other statuses are unchanged)", () => {
    const { container } = wrap(
      <ReviewPanel task={task({ status: "In Progress" })} profiles={profiles} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReviewProgress rows variant", () => {
  it("uses a segmented bar with one segment per reviewer, coloured by that reviewer's status", () => {
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        variant="rows"
        decisions={[dec(R1, "approved"), dec(R2), dec(R3, "changes_requested")]}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Reviewer approvals" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    const segs = Array.from(bar.children);
    expect(segs[0]).toHaveClass("bg-emerald-400");
    expect(segs[1]).toHaveClass("bg-slate-600/60");
    expect(segs[2]).toHaveClass("bg-amber-400");
    expect(screen.getByText(/1 requested changes/)).toBeInTheDocument();
  });

  it("names the person who decided when a manager decided on a reviewer's behalf", () => {
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        variant="rows"
        decisions={[dec(R1, "approved", { decided_by: M })]}
      />,
    );
    expect(screen.getByText(/by Max/)).toBeInTheDocument();
  });

  it("a single reviewer reads 'Reviewer', several read 'Reviewers'", () => {
    const one = wrap(
      <ReviewProgress task={task()} profiles={profiles} variant="rows" decisions={[dec(R1)]} />,
    );
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    one.unmount();
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        variant="rows"
        decisions={[dec(R1), dec(R2)]}
      />,
    );
    expect(screen.getByText("Reviewers")).toBeInTheDocument();
  });
});
