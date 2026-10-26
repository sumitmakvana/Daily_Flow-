import { describe, it, expect } from "vitest";
import {
  approvalBlocker,
  canDecideReview,
  canLogReviewHours,
  myDecision,
  pendingReviewerIds,
  summarizeReviewers,
  canSubmitForReview,
  formatBetween,
  formatReviewTime,
  timerGap,
  formatElapsed,
  isMyReview,
  isReviewAging,
  previouslyLogged,
  runningTimerHours,
  suggestLoggedHours,
  reviewSubmittedAt,
  submitBlocker,
} from "@/lib/review";
import type { ReviewerDecision, Task } from "@/lib/types";

const A = "assignee";
const R = "reviewer";
const M = "manager";
const X = "other";

const task = (o: Partial<Task> = {}) =>
  ({ status: "In Progress", assigned_to: A, reviewer: R, ...o }) as Pick<
    Task,
    "status" | "assigned_to" | "reviewer"
  >;

describe("submitBlocker / canSubmitForReview", () => {
  it("lets the assignee send an In Progress task with a reviewer", () => {
    expect(submitBlocker(task(), { userId: A, isManager: false })).toBeNull();
    expect(canSubmitForReview(task(), { userId: A, isManager: false })).toBe(true);
  });

  it("lets a manager send someone else's task", () => {
    expect(canSubmitForReview(task(), { userId: M, isManager: true })).toBe(true);
  });

  it("blocks unrelated members", () => {
    expect(submitBlocker(task(), { userId: X, isManager: false })).toMatch(/assignee or a manager/);
  });

  it.each(["To Do", "In Review", "Blocked", "On Hold", "Completed"] as const)(
    "blocks a %s task",
    (status) => {
      expect(submitBlocker(task({ status }), { userId: A, isManager: false })).toMatch(
        /In Progress/,
      );
    },
  );

  it("requires a reviewer", () => {
    expect(submitBlocker(task({ reviewer: null }), { userId: A, isManager: false })).toMatch(
      /reviewer/,
    );
  });

  it("rejects reviewer = assignee", () => {
    expect(submitBlocker(task({ reviewer: A }), { userId: A, isManager: false })).toMatch(
      /cannot be the assignee/,
    );
  });

  it("requires an assignee", () => {
    expect(submitBlocker(task({ assigned_to: null }), { userId: M, isManager: true })).toMatch(
      /Assign this task/,
    );
  });
});

describe("canDecideReview", () => {
  const inReview = task({ status: "In Review" });

  it("lets the assigned reviewer decide", () => {
    expect(canDecideReview(inReview, { userId: R, isManager: false })).toBe(true);
  });

  it("lets any manager/admin decide", () => {
    expect(canDecideReview(inReview, { userId: M, isManager: true })).toBe(true);
  });

  it("never lets the assignee decide, even as a manager (no self-approval)", () => {
    expect(canDecideReview(inReview, { userId: A, isManager: false })).toBe(false);
    expect(canDecideReview(inReview, { userId: A, isManager: true })).toBe(false);
  });

  it("never lets whoever submitted the work decide it", () => {
    expect(canDecideReview(inReview, { userId: M, isManager: true }, M)).toBe(false);
  });

  it("denies unrelated members", () => {
    expect(canDecideReview(inReview, { userId: X, isManager: false })).toBe(false);
  });

  it("only applies to tasks that are In Review", () => {
    expect(canDecideReview(task({ status: "In Progress" }), { userId: R, isManager: false })).toBe(
      false,
    );
    expect(canDecideReview(task({ status: "Completed" }), { userId: M, isManager: true })).toBe(
      false,
    );
  });
});

describe("isMyReview", () => {
  it("is the reviewer's In Review queue only", () => {
    expect(isMyReview({ status: "In Review", reviewer: R }, R)).toBe(true);
    expect(isMyReview({ status: "In Review", reviewer: R }, X)).toBe(false);
    expect(isMyReview({ status: "In Progress", reviewer: R }, R)).toBe(false);
    expect(isMyReview({ status: "In Review", reviewer: null }, "")).toBe(false);
  });
});

describe("review timing", () => {
  const T0 = Date.parse("2026-10-26T10:00:00Z");

  it("formats elapsed time compactly", () => {
    const at = (ms: number) => new Date(T0 - ms).toISOString();
    expect(formatElapsed(at(20_000), T0)).toBe("<1m");
    expect(formatElapsed(at(42 * 60_000), T0)).toBe("42m");
    expect(formatElapsed(at((3 * 60 + 20) * 60_000), T0)).toBe("3h 20m");
    expect(formatElapsed(at((2 * 24 + 4) * 3_600_000), T0)).toBe("2d 4h");
  });

  it("handles missing/invalid input and future timestamps", () => {
    expect(formatElapsed(null)).toBe("—");
    expect(formatElapsed("not a date")).toBe("—");
    expect(formatElapsed(new Date(T0 + 60_000).toISOString(), T0)).toBe("<1m");
  });

  it("measures a finished cycle", () => {
    expect(formatBetween("2026-10-26T10:00:00Z", "2026-10-26T12:30:00Z")).toBe("2h 30m");
  });

  it("flags reviews waiting more than a day", () => {
    expect(isReviewAging(new Date(T0 - 25 * 3_600_000).toISOString(), T0)).toBe(true);
    expect(isReviewAging(new Date(T0 - 23 * 3_600_000).toISOString(), T0)).toBe(false);
    expect(isReviewAging(null, T0)).toBe(false);
  });

  it("falls back to updated_at for tasks that were already In Review", () => {
    expect(
      reviewSubmittedAt({
        review_submitted_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
      }),
    ).toBe("2026-10-01T00:00:00Z");
    expect(
      reviewSubmittedAt({ review_submitted_at: null, updated_at: "2026-10-02T00:00:00Z" }),
    ).toBe("2026-10-02T00:00:00Z");
  });
});

describe("logged hours rules", () => {
  it("approval needs logged hours", () => {
    expect(approvalBlocker({ actual_hours: 0 })).toMatch(/logged hours/);
    expect(approvalBlocker({ actual_hours: null })).toMatch(/logged hours/);
    expect(approvalBlocker({ actual_hours: 0.5 })).toBeNull();
  });

  it("only the assignee can enter hours, and only while the task is in review", () => {
    const inReview = task({ status: "In Review" });
    expect(canLogReviewHours(inReview, { userId: A, isManager: false })).toBe(true);
    expect(canLogReviewHours(inReview, { userId: M, isManager: true })).toBe(false);
    expect(canLogReviewHours(inReview, { userId: R, isManager: false })).toBe(false);
    expect(
      canLogReviewHours(task({ status: "In Progress" }), { userId: A, isManager: false }),
    ).toBe(false);
  });

  it("running timer hours are capped at 8h and never negative", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(runningTimerHours(null, now)).toBe(0);
    expect(runningTimerHours("2026-10-26T10:30:00Z", now)).toBe(1.5);
    expect(runningTimerHours("2026-10-24T12:00:00Z", now)).toBe(8);
    expect(runningTimerHours("2026-10-26T13:00:00Z", now)).toBe(0);
  });

  describe("suggestLoggedHours", () => {
    const base = {
      todaySubmission: null,
      todaySystemHours: 0,
      runningHours: 0,
      totalLogged: 0,
      planned: 0,
    };

    it("an existing submission for today wins, so re-opening never invents a number", () => {
      expect(suggestLoggedHours({ ...base, todaySubmission: 2, todaySystemHours: 5 })).toBe(2);
    });

    it("otherwise suggests today's tracked time including the running segment", () => {
      expect(suggestLoggedHours({ ...base, todaySystemHours: 1.25, runningHours: 0.5 })).toBe(1.75);
    });

    it("falls back to the plan only for a task with nothing logged yet", () => {
      expect(suggestLoggedHours({ ...base, planned: 4 })).toBe(4);
      expect(suggestLoggedHours({ ...base, planned: 4, totalLogged: 3 })).toBe(0);
    });
  });

  it("previouslyLogged is the total minus today's submission, never negative", () => {
    expect(previouslyLogged(5.5, 1.5)).toBe(4);
    expect(previouslyLogged(5.5, null)).toBe(5.5);
    expect(previouslyLogged(1, 3)).toBe(0);
  });
});

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

describe("multiple reviewers: per-reviewer rules", () => {
  const inReview = task({ status: "In Review" });
  const R1 = "r1";
  const R2 = "r2";
  const R3 = "r3";

  describe("summarizeReviewers", () => {
    it("counts each reviewer's own status; fully approved only when every one approved", () => {
      expect(summarizeReviewers([dec(R1, "approved"), dec(R2), dec(R3)])).toEqual({
        total: 3,
        approved: 1,
        changesRequested: 0,
        pending: 2,
        fullyApproved: false,
      });
      expect(summarizeReviewers([dec(R1, "approved"), dec(R2, "approved")]).fullyApproved).toBe(
        true,
      );
    });

    it("one change request is visible and blocks full approval", () => {
      const s = summarizeReviewers([dec(R1, "approved"), dec(R2, "changes_requested"), dec(R3)]);
      expect(s).toMatchObject({
        approved: 1,
        changesRequested: 1,
        pending: 1,
        fullyApproved: false,
      });
    });

    it("ignores withdrawn reviewers and never reports an empty list as approved", () => {
      expect(summarizeReviewers([dec(R1, "approved"), dec(R2, "withdrawn")])).toMatchObject({
        total: 1,
        fullyApproved: true,
      });
      expect(summarizeReviewers([]).fullyApproved).toBe(false);
      expect(summarizeReviewers(null).total).toBe(0);
    });
  });

  describe("canDecideReview with per-reviewer decisions", () => {
    const decisions = [dec(R1, "approved"), dec(R2), dec(R3)];

    it("a reviewer can decide only while THEIR OWN status is pending", () => {
      expect(canDecideReview(inReview, { userId: R2, isManager: false }, null, decisions)).toBe(
        true,
      );
      expect(canDecideReview(inReview, { userId: R1, isManager: false }, null, decisions)).toBe(
        false,
      );
    });

    it("a reviewer who already approved stays locked out even if they are a manager", () => {
      expect(canDecideReview(inReview, { userId: R1, isManager: true }, null, decisions)).toBe(
        false,
      );
    });

    it("a manager who is not a reviewer can decide while someone is pending", () => {
      expect(canDecideReview(inReview, { userId: M, isManager: true }, null, decisions)).toBe(true);
      expect(
        canDecideReview(inReview, { userId: M, isManager: true }, null, [dec(R1, "approved")]),
      ).toBe(false);
    });

    it("a non-reviewer member cannot decide", () => {
      expect(canDecideReview(inReview, { userId: X, isManager: false }, null, decisions)).toBe(
        false,
      );
    });

    it("never the assignee or the submitter, whatever the decisions say", () => {
      const withAssignee = [dec(A), dec(R2)];
      expect(canDecideReview(inReview, { userId: A, isManager: true }, null, withAssignee)).toBe(
        false,
      );
      expect(canDecideReview(inReview, { userId: M, isManager: true }, M, decisions)).toBe(false);
    });

    it("a withdrawn reviewer is no longer a reviewer", () => {
      expect(
        canDecideReview(inReview, { userId: R3, isManager: false }, null, [
          dec(R3, "withdrawn"),
          dec(R2),
        ]),
      ).toBe(false);
    });

    it("without decisions it falls back to the primary reviewer or a manager (old behaviour)", () => {
      expect(canDecideReview(inReview, { userId: R, isManager: false })).toBe(true);
      expect(canDecideReview(inReview, { userId: X, isManager: false })).toBe(false);
    });
  });

  it("myDecision finds the caller's own non-withdrawn row", () => {
    const d = [dec(R1, "approved"), dec(R2, "withdrawn"), dec(R3)];
    expect(myDecision(d, R1)?.decision).toBe("approved");
    expect(myDecision(d, R2)).toBeUndefined();
    expect(myDecision(d, X)).toBeUndefined();
    expect(myDecision(null, R1)).toBeUndefined();
  });

  it("pendingReviewerIds lists who a manager could decide for", () => {
    expect(
      pendingReviewerIds([dec(R1, "approved"), dec(R2), dec(R3, "changes_requested")]),
    ).toEqual([R2]);
    expect(pendingReviewerIds(undefined)).toEqual([]);
  });
});

describe("timerGap", () => {
  it("is 'in line' within 15 minutes either way", () => {
    expect(timerGap(2, 2.1)).toMatchObject({
      direction: "match",
      label: "In line",
      significant: false,
    });
    expect(timerGap(2, 1.8)).toMatchObject({ direction: "match" });
  });

  it("shows how much longer the timer ran than was logged", () => {
    const g = timerGap(2, 2 + 55 / 60);
    expect(g).toMatchObject({ direction: "timer_ahead", label: "+55m", significant: false });
    expect(g.title).toMatch(/timer tracked 55m more than was logged/i);
  });

  it("shows how much more was logged than the timer tracked, with a real minus sign", () => {
    const g = timerGap(3, 1.75);
    expect(g.direction).toBe("logged_ahead");
    expect(g.label).toBe("\u22121h 15m");
    expect(g.title).toMatch(/1h 15m more was logged than the timer tracked/i);
  });

  it("flags a gap of 1.5h or more as significant (same threshold as the hours badge)", () => {
    expect(timerGap(2, 3.5).significant).toBe(true);
    expect(timerGap(2, 3.4).significant).toBe(false);
    expect(timerGap(4, 2.4).significant).toBe(true);
  });

  it("has nothing to compare until both numbers exist", () => {
    expect(timerGap(0, 3)).toMatchObject({ direction: "unknown", label: "\u2014" });
    expect(timerGap(2, 0)).toMatchObject({ direction: "unknown", label: "\u2014" });
    expect(timerGap(null, undefined).direction).toBe("unknown");
  });
});

describe("formatReviewTime", () => {
  it("is a compact day-month, time stamp", () => {
    expect(formatReviewTime("2026-10-26T14:20:00")).toMatch(/26 Oct.*14:20/);
  });
});
