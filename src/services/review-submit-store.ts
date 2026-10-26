import { useEffect, useState } from "react";
import type { Task } from "@/lib/types";

/** "submit": send an In Progress task for review. "confirm": assignee updates hours while in review. */
export type ReviewSubmitMode = "submit" | "confirm";

interface ReviewSubmitState {
  task: Task | null;
  mode: ReviewSubmitMode;
  open: boolean;
  onDone?: () => void;
}

let currentState: ReviewSubmitState = { task: null, mode: "submit", open: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Opens the "confirm logged hours" dialog (mounted once in AppShell) from anywhere:
 * task cards, the board, the detail modal and the Reviews page.
 */
export const reviewSubmitStore = {
  get: () => currentState,
  open: (task: Task, mode: ReviewSubmitMode = "submit", onDone?: () => void) => {
    currentState = { task, mode, open: true, onDone };
    emit();
  },
  close: () => {
    currentState = { ...currentState, open: false };
    emit();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useReviewSubmitStore() {
  const [state, setState] = useState<ReviewSubmitState>(reviewSubmitStore.get());
  useEffect(() => reviewSubmitStore.subscribe(() => setState(reviewSubmitStore.get())), []);
  return state;
}
