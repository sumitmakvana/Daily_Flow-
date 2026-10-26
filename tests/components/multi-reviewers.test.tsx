import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  reviewsService: {
    listForTask: vi.fn(async () => (cycle ? [cycle] : [])),
    approve: vi.fn(),
    requestChanges: vi.fn(),
    submit: vi.fn(),
    logHours: vi.fn(),
  },
}));

import { reviewsService } from "@/services/reviews";
import { ReviewProgress } from "@/components/review/ReviewProgress";
import { ReviewActions } from "@/components/review/ReviewActions";
import { ReviewerPicker } from "@/components/review/ReviewerPicker";
import { cleanReviewerList } from "@/lib/review";

const A = "a-assignee";
const R1 = "r1";
const R2 = "r2";
const R3 = "r3";
const M = "m-manager";
const profiles = [
  { id: A, display_name: "Alice" },
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
  decided_at: decision === "pending" ? null : "2026-10-26T10:00:00Z",
  feedback: null,
  ...extra,
});

const task = (over: Partial<Task> = {}) =>
  ({
    id: "t1",
    task_code: "T-1",
    task_name: "X",
    status: "In Review",
    assigned_to: A,
    reviewer: R1,
    actual_hours: 2,
    review_submitted_at: "2026-10-26T09:00:00Z",
    version: 3,
    ...over,
  }) as Task;

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe("ReviewProgress", () => {
  it("shows each reviewer's own status and how many have approved", () => {
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        decisions={[dec(R1, "approved"), dec(R2), dec(R3, "changes_requested")]}
      />,
    );
    expect(screen.getByText(/1\/3 approved/)).toBeInTheDocument();
    expect(screen.getByText(/1 requested changes/)).toBeInTheDocument();
    expect(screen.getByTitle("Rita: approved")).toBeInTheDocument();
    expect(screen.getByTitle("Rob: waiting for review")).toBeInTheDocument();
    expect(screen.getByTitle("Ravi: requested changes")).toBeInTheDocument();
  });

  it("says who actually decided when a manager decided on a reviewer's behalf", () => {
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        decisions={[dec(R1, "approved", { decided_by: M })]}
      />,
    );
    expect(screen.getByTitle("Rita: approved (decided by Max)")).toBeInTheDocument();
  });

  it("marks the review fully approved only when every reviewer approved", () => {
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        decisions={[dec(R1, "approved"), dec(R2, "approved")]}
      />,
    );
    expect(screen.getByText("2/2 approved")).toHaveClass("text-emerald-500");
  });

  it("does not count withdrawn reviewers", () => {
    wrap(
      <ReviewProgress
        task={task()}
        profiles={profiles}
        decisions={[dec(R1, "approved"), dec(R2, "withdrawn")]}
      />,
    );
    expect(screen.getByText("1/1 approved")).toBeInTheDocument();
    expect(screen.queryByText("Rob")).not.toBeInTheDocument();
  });

  it("renders nothing for a task that is not in review", () => {
    const { container } = wrap(
      <ReviewProgress
        task={task({ status: "In Progress" })}
        profiles={profiles}
        decisions={[dec(R1)]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("loads the current cycle's reviewers itself when none are passed in", async () => {
    cycle = {
      id: "c2",
      cycle_no: 2,
      decision: "pending",
      reviewers: [dec(R1, "approved"), dec(R2)],
    };
    wrap(<ReviewProgress task={task()} profiles={profiles} />);
    await waitFor(() => expect(screen.getByText(/1\/2 approved/)).toBeInTheDocument());
  });
});

describe("ReviewActions with several reviewers", () => {
  beforeEach(() => {
    cycle = {
      id: "c1",
      cycle_no: 1,
      decision: "pending",
      submitted_by: A,
      reviewers: [dec(R1, "approved"), dec(R2), dec(R3)],
    };
  });

  // wait until the per-reviewer statuses have been fetched and applied
  const settled = async () => {
    await waitFor(() => expect(reviewsService.listForTask).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  const renderFor = (userId: string, isManager = false, t: Task = task()) =>
    wrap(
      <ReviewActions
        task={t}
        userId={userId}
        isManager={isManager}
        onChanged={() => {}}
        profiles={profiles}
      />,
    );

  it("a reviewer whose own status is pending can approve or request changes", async () => {
    renderFor(R2);
    expect(await screen.findByRole("button", { name: /Approve/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Request changes/ })).toBeInTheDocument();
  });

  it("a reviewer who already approved gets no decision buttons", async () => {
    renderFor(R1);
    await settled();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request changes/ })).not.toBeInTheDocument();
  });

  it("a manager who is not a reviewer can decide on behalf of a pending reviewer", async () => {
    renderFor(M, true);
    expect(await screen.findByRole("button", { name: /Approve/ })).toBeInTheDocument();
  });

  it("an outsider and the assignee never get decision buttons", async () => {
    renderFor("x-other");
    await settled();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
  });

  it("the assignee can only update logged hours, never decide", async () => {
    renderFor(A, true);
    expect(await screen.findByRole("button", { name: /logged hours/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
  });

  it("approval is disabled until the assignee has logged hours", async () => {
    renderFor(R2, false, task({ actual_hours: 0 }));
    const approve = await screen.findByRole("button", { name: /Approve/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", expect.stringMatching(/logged hours/i));
  });

  it("opens the approve dialog and explains that approval is only this reviewer's", async () => {
    renderFor(R2);
    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    expect(await screen.findByText(/records your approval only/i)).toBeInTheDocument();
  });
});

describe("ReviewerPicker", () => {
  it("cleanReviewerList drops duplicates and the assignee but keeps the order", () => {
    expect(cleanReviewerList([R2, A, R1, R2, "", R3], A)).toEqual([R2, R1, R3]);
  });

  it("caps the list at 10 reviewers", () => {
    const many = Array.from({ length: 14 }, (_, i) => `u${i}`);
    expect(cleanReviewerList(many, null)).toHaveLength(10);
  });

  it("shows a chip per reviewer and marks the first as primary", () => {
    render(
      <ReviewerPicker value={[R2, R1]} onChange={() => {}} profiles={profiles} assigneeId={A} />,
    );
    expect(screen.getByText("2 reviewers")).toBeInTheDocument();
    expect(screen.getByText("(primary)")).toBeInTheDocument();
    expect(screen.getByText(/only when all have approved/i)).toBeInTheDocument();
  });

  it("never offers the assignee, and toggling keeps the click order", () => {
    const onChange = vi.fn();
    render(<ReviewerPicker value={[R2]} onChange={onChange} profiles={profiles} assigneeId={A} />);
    fireEvent.click(screen.getByRole("button", { name: "Rob" }));
    expect(screen.queryByRole("checkbox", { name: /Alice/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Rita/ }));
    expect(onChange).toHaveBeenCalledWith([R2, R1]);
  });

  it("removing a chip removes only that reviewer", () => {
    const onChange = vi.fn();
    render(<ReviewerPicker value={[R1, R2, R3]} onChange={onChange} profiles={profiles} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rob" }));
    expect(onChange).toHaveBeenCalledWith([R1, R3]);
  });

  it("is read-only when disabled (a locked task in review)", () => {
    render(
      <ReviewerPicker
        value={[R1]}
        onChange={() => {}}
        profiles={profiles}
        disabled
        disabledReason="Only a manager can change the reviewers"
      />,
    );
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rita/ })).toBeDisabled();
  });
});
