import { useState, useEffect } from "react";
import type { Task } from "@/lib/types";

interface CompleteEodState {
  task: Task | null;
  open: boolean;
  onDone?: () => void;
}

let currentState: CompleteEodState = {
  task: null,
  open: false,
  onDone: undefined,
};

const listeners = new Set<() => void>();

export const completeEodStore = {
  get: () => currentState,
  open: (task: Task, onDone?: () => void) => {
    currentState = { task, open: true, onDone };
    listeners.forEach((l) => l());
  },
  close: () => {
    currentState = { ...currentState, open: false };
    listeners.forEach((l) => l());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCompleteEodStore() {
  const [state, setState] = useState<CompleteEodState>(completeEodStore.get());
  useEffect(() => {
    const unsubscribe = completeEodStore.subscribe(() => setState(completeEodStore.get()));
    return () => {
      unsubscribe();
    };
  }, []);
  return state;
}
